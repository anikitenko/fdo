import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import {HotkeysTarget, useHotkeys} from "@blueprintjs/core";
import virtualFS from "../editor/utils/VirtualFS";
import {AppToaster} from "../AppToaster.jsx";
import * as styles from "./snapshots.module.css";

const SnapshotContext = createContext(null);

export const useSnapshots = () => useContext(SnapshotContext);

export const SnapshotProvider = ({children}) => {
  const [versions, setVersions] = useState(virtualFS.fs.list());
  const [current, setCurrent] = useState(virtualFS.fs.version());
  const [loading, setLoading] = useState(virtualFS.fs.getLoading());
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const pendingVersionRef = useRef(null);

  // Subscribe to FS events
  useEffect(() => {
    const unsubA = virtualFS.notifications.subscribe("treeVersionsUpdate", (v) => setVersions(v));
    const unsubB = virtualFS.notifications.subscribe("treeLoading", (l) => setLoading(l));
    const unsubC = virtualFS.notifications.subscribe("snapshotError", async (payload) => {
      (await AppToaster).show({message: payload?.message || "Snapshot error", intent: "danger"});
      console.error("snapshotError", payload);
      setCreating(false);
      setSwitching(false);
      pendingVersionRef.current = null;
    });
    const unsubD = virtualFS.notifications.subscribe("fileSelected", () => setCurrent(virtualFS.fs.version()));
    return () => {unsubA();unsubB();unsubC();unsubD();};
  }, []);

  const createSnapshot = useCallback(async () => {
    if (creating) return null;
    try {
      setCreating(true);
      const currentVersion = virtualFS.fs.version();
      const tabs = virtualFS.tabs.get().filter((t) => t.id !== "Untitled").map((t) => ({id: t.id, active: t.active}));
      const created = virtualFS.fs.create(currentVersion.version, tabs);
      pendingVersionRef.current = created.version;
      // Optimistic toast with actions
      (await AppToaster).show({
        message: `Snapshot ${created.version} created`, intent: "success", action: {
          text: "Switch",
          onClick: () => switchTo(created.version)
        }
      });
      setCreating(false);
      return created;
    } catch (e) {
      setCreating(false);
      (await AppToaster).show({message: `Failed to create snapshot: ${e.message}`, intent: "danger"});
      return null;
    }
  }, [creating]);

  const switchTo = useCallback(async (versionId) => {
    if (!versionId) return;
    if (switching) return;
    try {
      setSwitching(true);
      const data = virtualFS.fs.set(versionId);
      if (data?.tabs) {
        virtualFS.tabs.addMultiple(data.tabs);
      }
      (await AppToaster).show({message: `Switched to ${versionId}`, intent: "primary"});
    } catch (e) {
      (await AppToaster).show({message: `Failed to switch: ${e.message}`, intent: "danger"});
    } finally {
      setSwitching(false);
      pendingVersionRef.current = null;
    }
  }, [switching]);

  const renameSnapshot = useCallback(async (oldId, newId) => {
    if (!newId || newId === oldId) return false;
    const ok = virtualFS.fs.renameVersion(oldId, newId);
    if (ok) {
      (await AppToaster).show({message: `Renamed ${oldId} → ${newId}`, intent: "success"});
    }
    return ok;
  }, []);

  const deleteSnapshot = useCallback(async (id) => {
    const ok = virtualFS.fs.deleteVersion(id);
    if (ok) {
      (await AppToaster).show({message: `Deleted ${id}`, intent: "warning"});
      // If deleted current, switch to latest
      const latest = virtualFS.fs.version();
      setCurrent(latest);
    }
    return ok;
  }, []);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  // Hotkeys
  const hotkeys = useMemo(() => [{
    combo: "mod+shift+s",
    group: "Snapshots",
    label: "Create snapshot",
    onKeyDown: () => { createSnapshot(); },
    preventDefault: true,
    global: true,
  }], [createSnapshot]);
  const {handleKeyDown, handleKeyUp} = useHotkeys(hotkeys);

  const value = useMemo(() => ({
    versions, current, loading, creating, switching, panelOpen,
    createSnapshot, switchTo, renameSnapshot, deleteSnapshot,
    openPanel, closePanel
  }), [versions, current, loading, creating, switching, panelOpen, createSnapshot, switchTo, renameSnapshot, deleteSnapshot, openPanel, closePanel]);

  return (
    <HotkeysTarget hotkeys={hotkeys}>
      {({ handleKeyDown: hkDown, handleKeyUp: hkUp }) => (
        <div
          className={styles["snapshot-provider-root"]}
          onKeyDown={(e) => { hkDown(e); handleKeyDown(e); }}
          onKeyUp={(e) => { hkUp(e); handleKeyUp(e); }}
          tabIndex={0}
          aria-label="Snapshots hotkeys container"
          style={{ outline: "none" }}
        >
          <SnapshotContext.Provider value={value}>{children}</SnapshotContext.Provider>
        </div>
      )}
    </HotkeysTarget>
  );
};
