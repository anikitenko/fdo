import React, {useMemo, useState} from "react";
import {Button, ButtonGroup, Divider, Drawer, H4, InputGroup, NonIdealState, Spinner} from "@blueprintjs/core";
import {useSnapshots} from "./SnapshotContext.jsx";
import SnapshotTimeline from "./SnapshotTimeline.jsx";
import * as styles from "./snapshots.module.css";

const Header = ({onClose}) => (
  <div className={styles["drawer-header"]}>
    <H4>Snapshots</H4>
    <Button variant={"minimal"} icon="cross" onClick={onClose} />
  </div>
);

const Footer = ({creating, onCreate}) => (
  <div className={styles["drawer-footer"]}>
    <ButtonGroup>
      <Button intent="success" icon="camera" text="Create snapshot" loading={creating} onClick={onCreate} />
    </ButtonGroup>
  </div>
);

const SnapshotPanel = () => {
  const {panelOpen, closePanel, versions, current, loading, creating, createSnapshot, requestSwitch, renameSnapshot, deleteSnapshot} = useSnapshots();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query) return versions;
    const q = query.toLowerCase();
    return versions.filter(v => v.version.toLowerCase().includes(q) || (v.prev||"").toLowerCase().includes(q));
  }, [query, versions]);

  return (
    <Drawer isOpen={panelOpen} onClose={closePanel} canOutsideClickClose position="right" size={"40%"} className={styles["drawer-root"]}>
      <div className={styles["drawer-content"]}>
        <Header onClose={closePanel} />
        <Divider />
        <div className={styles["search-row"]}>
          <InputGroup leftIcon="search" placeholder="Search snapshots…" value={query} onChange={(e)=>setQuery(e.target.value)} />
        </div>
        <div className={styles["timeline-container"]}>
          {loading ? (
            <div className={styles["loading-box"]}><Spinner /></div>
          ) : filtered.length === 0 ? (
            <NonIdealState title="No snapshots" description="Create your first snapshot to get started." icon="camera" />
          ) : (
            <SnapshotTimeline versions={filtered} current={current} onSwitch={requestSwitch} onRename={renameSnapshot} onDelete={deleteSnapshot} />
          )}
        </div>
        <Divider />
        <Footer creating={creating} onCreate={createSnapshot} />
      </div>
    </Drawer>
  );
};

export default SnapshotPanel;
