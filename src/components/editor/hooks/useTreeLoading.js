import { useEffect, useState } from 'react';

import virtualFS from '../utils/VirtualFS';

export function useTreeLoading() {
  const [treeLoading, setTreeLoading] = useState(virtualFS.fs.getLoading());

  useEffect(() => {
    const unsubscribe = virtualFS.notifications.subscribe('treeLoading', setTreeLoading);
    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  return treeLoading;
}

