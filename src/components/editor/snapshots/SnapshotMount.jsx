import React from "react";
import {SnapshotProvider} from "./SnapshotContext.jsx";
import SnapshotToolbarActions from "./SnapshotToolbarActions.jsx";
import SnapshotPanel from "./SnapshotPanel.jsx";

const SnapshotToolbarMount = () => {
  return (
    <SnapshotProvider>
      <SnapshotToolbarActions />
      <SnapshotPanel />
    </SnapshotProvider>
  );
};

export default SnapshotToolbarMount;
