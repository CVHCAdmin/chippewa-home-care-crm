// Module-level flag so VersionWatcher (mounted in App, above the dashboards) can
// tell whether a caregiver is mid-shift or mid clock action. A silent auto-reload
// must never fire while a punch is in flight or a shift is open.
let busy = false;

export const setShiftBusy = (value) => { busy = !!value; };
export const isShiftBusy = () => busy;
