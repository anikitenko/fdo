import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from "react";
import {Button, Dialog, DialogBody, DialogFooter, InputGroup, HotkeysTarget, useHotkeys} from "@blueprintjs/core";
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
  
  // Rename dialog state
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameFrom, setRenameFrom] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef(null);

  // Inline confirmation banner state
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [confirmSwitchTarget, setConfirmSwitchTarget] = useState(null);

  const pendingVersionRef = useRef(null);
  const contentDisposersRef = useRef([]);

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
    const unsubE = virtualFS.notifications.subscribe("treeUpdate", () => {
      // Models likely recreated; rebind listeners
      bindModelChangeListeners();
    });
    return () => {unsubA();unsubB();unsubC();unsubD();unsubE(); disposeModelChangeListeners();};
  }, []);

  // Bind to monaco models to detect unsaved edits
  const disposeModelChangeListeners = () => {
    try { contentDisposersRef.current.forEach((d) => d && d.dispose && d.dispose()); } catch(_) {}
    contentDisposersRef.current = [];
  };
  const bindModelChangeListeners = useCallback(() => {
    disposeModelChangeListeners();
    try {
      const models = virtualFS.listModels ? virtualFS.listModels() : [];
      models.forEach((m) => {
        if (!m || !m.onDidChangeContent) return;
        const d = m.onDidChangeContent(() => setHasUnsavedChanges(true));
        contentDisposersRef.current.push(d);
      });
    } catch (_) {}
  }, []);

  useEffect(() => { bindModelChangeListeners(); }, [bindModelChangeListeners]);

  const resetUnsaved = () => setHasUnsavedChanges(false);

  const openRenameDialog = useCallback((fromId) => {
    if (!fromId) return;
    setRenameFrom(fromId);
    setRenameValue(fromId);
    setRenameOpen(true);
  }, []);
  const closeRenameDialog = useCallback(() => {
    setRenameOpen(false);
    setRenameFrom("");
    setRenameValue("");
  }, []);
  const renameSnapshot = useCallback(async (oldId, newId) => {
    if (!newId || newId === oldId) return false;
    const ok = virtualFS.fs.renameVersion(oldId, newId);
    if (ok) {
      (await AppToaster).show({message: `Renamed ${oldId} → ${newId}`, intent: "success"});
    }
    return ok;
  }, []);

  const confirmRenameDialog = useCallback(async () => {
    const proposed = (renameValue || "").trim();
    const fromId = renameFrom;
    if (!proposed || proposed === fromId) {
      closeRenameDialog();
      return;
    }
    try {
      await renameSnapshot(fromId, proposed);
    } finally {
      closeRenameDialog();
    }
  }, [renameValue, renameFrom, renameSnapshot, closeRenameDialog]);

  const createSnapshot = useCallback(async () => {
    if (creating) return null;
    try {
      setCreating(true);
      const currentVersion = virtualFS.fs.version();
      const tabs = virtualFS.tabs.get().filter((t) => t.id !== "Untitled").map((t) => ({id: t.id, active: t.active}));
      const created = virtualFS.fs.create(currentVersion.version, tabs);
      pendingVersionRef.current = created.version;
      resetUnsaved();
      // Enhanced toast with the Rename quick action
      const message = (
        <div className={styles["toast-row"]}>
          <span>Snapshot {created.version} created</span>
          <span style={{flex:1}} />
          <Button size={"small"} variant={"minimal"} intent="primary" onClick={() => switchTo(created.version)}>Switch</Button>
          <Button
              size={"small"} variant={"minimal"}
            intent="success"
            onClick={() => openRenameDialog(created.version)}
          >Rename</Button>
        </div>
      );
      (await AppToaster).show({ message, intent: "success" });
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
      // Restore tabs atomically, filtering missing files and setting the correct active tab
      virtualFS.tabs.replaceFromSaved(data?.tabs || []);
      resetUnsaved();
      (await AppToaster).show({message: `Switched to ${versionId}`, intent: "primary"});
    } catch (e) {
      (await AppToaster).show({message: `Failed to switch: ${e.message}`, intent: "danger"});
    } finally {
      setSwitching(false);
      pendingVersionRef.current = null;
    }
  }, [switching]);

  // Request switch will gate via inline banner if there are unsaved edits
  const requestSwitch = useCallback((versionId) => {
    if (!versionId) return;
    if (hasUnsavedChanges) {
      setConfirmSwitchTarget(versionId);
    } else {
      switchTo(versionId);
    }
  }, [hasUnsavedChanges, switchTo]);

  const confirmSwitchCancel = useCallback(() => setConfirmSwitchTarget(null), []);
  const confirmSwitchProceed = useCallback(() => {
    if (confirmSwitchTarget) switchTo(confirmSwitchTarget);
    setConfirmSwitchTarget(null);
  }, [confirmSwitchTarget, switchTo]);
  const confirmSwitchCreateAndSwitch = useCallback(async () => {
    const created = await createSnapshot();
    const target = confirmSwitchTarget;
    setConfirmSwitchTarget(null);
    if (target) await switchTo(target);
    return created;
  }, [createSnapshot, confirmSwitchTarget, switchTo]);

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

  // Expose a safe global opener so legacy UI can open the timeline (Option B)
  useEffect(() => {
    try {
      window.__openSnapshotsPanel = () => setPanelOpen(true);
    } catch (_) {}
    return () => {
      try { if (window.__openSnapshotsPanel) delete window.__openSnapshotsPanel; } catch (_) {}
    };
  }, []);

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
    createSnapshot, switchTo, requestSwitch, renameSnapshot, deleteSnapshot,
    openPanel, closePanel,
    hasUnsavedChanges, confirmSwitchTarget,
    confirmSwitchCancel, confirmSwitchProceed, confirmSwitchCreateAndSwitch
  }), [versions, current, loading, creating, switching, panelOpen, createSnapshot, switchTo, requestSwitch, renameSnapshot, deleteSnapshot, openPanel, closePanel, hasUnsavedChanges, confirmSwitchTarget, confirmSwitchCancel, confirmSwitchProceed, confirmSwitchCreateAndSwitch]);

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
          <SnapshotContext.Provider value={value}>
            {children}
            <Dialog
              isOpen={renameOpen}
              onClose={closeRenameDialog}
              title="Rename snapshot"
              canEscapeKeyClose
              canOutsideClickClose
            >
              <DialogBody>
                <div style={{ marginBottom: 8 }}>Enter a new name for snapshot <strong>{renameFrom}</strong>:</div>
                <InputGroup
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  inputRef={renameInputRef}
                  placeholder="New snapshot name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); confirmRenameDialog(); }
                    if (e.key === "Escape") { e.preventDefault(); closeRenameDialog(); }
                  }}
                />
              </DialogBody>
              <DialogFooter
                actions={
                  <>
                    <Button onClick={closeRenameDialog}>Cancel</Button>
                    <Button intent="primary" onClick={confirmRenameDialog} disabled={!renameValue || renameValue.trim() === renameFrom}>
                      Save
                    </Button>
                  </>
                }
              />
            </Dialog>
          </SnapshotContext.Provider>
        </div>
      )}
    </HotkeysTarget>
  );
};
