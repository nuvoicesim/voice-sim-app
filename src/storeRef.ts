/**
 * Holds a lazy reference to the Redux store.
 * Exists as a separate module to break the circular dependency:
 *   store -> slices -> api -> apiClient -> store
 */

import type { Store } from "@reduxjs/toolkit";

let _store: Store | null = null;

export function setStoreRef(store: Store) {
  _store = store;
}

export function getStoreRef(): Store | null {
  return _store;
}
