import React, {useEffect, useState} from "react";
import {SnapshotProvider} from "./SnapshotContext.jsx";
import SnapshotToolbarActions from "./SnapshotToolbarActions.jsx";
import SnapshotPanel from "./SnapshotPanel.jsx";

let snapshotToolbarMounted = false;

const SnapshotToolbarMount = () => {
  const [active, setActive] = useState(() => !snapshotToolbarMounted);

  useEffect(() => {
    if (snapshotToolbarMounted) {
      setActive(false);
      return undefined;
    }
    snapshotToolbarMounted = true;
    setActive(true);
    return () => {
      snapshotToolbarMounted = false;
    };
  }, []);

  if (!active) {
    return null;
  }

  return (
    <SnapshotProvider>
      <SnapshotToolbarActions />
      <SnapshotPanel />
    </SnapshotProvider>
  );
};

export default SnapshotToolbarMount;
