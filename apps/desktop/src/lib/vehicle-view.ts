// Which vehicle the app is showing versus which one the adapter is talking
// to (multi-brand plan P4.5, review of #66 item 1). The two are separate on
// purpose: browsing a stored vehicle while another one is connected must
// never enable live controls (scans, clears, captures) against the wrong car.

export type VehicleViewInput = {
  connected: boolean;
  /** `ConnStatus.vehicle_id` — the car on the wire, or null. */
  connectedVehicleId: number | null;
  /** The sidebar selection, or null when the user never picked one. */
  selectedVehicleId: number | null;
  /** Ids the database knows (the switcher's options). */
  knownVehicleIds: number[];
};

export type VehicleView = {
  /** The vehicle every view shows; null when nothing is known. */
  viewVehicleId: number | null;
  /** Live controls allowed: connected AND showing the connected car. */
  liveEnabled: boolean;
  /** True when a car is connected but the user is browsing another one. */
  browsing: boolean;
};

export function resolveVehicleView(input: VehicleViewInput): VehicleView {
  const { connected, connectedVehicleId, selectedVehicleId, knownVehicleIds } = input;
  const selectionValid = selectedVehicleId != null && knownVehicleIds.includes(selectedVehicleId);
  const viewVehicleId = selectionValid ? selectedVehicleId : (connectedVehicleId ?? knownVehicleIds[0] ?? null);
  const onConnectedCar = connected && connectedVehicleId != null && viewVehicleId === connectedVehicleId;
  // A connected but still unidentified car (no vehicle_id yet) keeps its
  // live controls as long as nothing else is being browsed.
  const unidentifiedLive = connected && connectedVehicleId == null && viewVehicleId == null;
  return {
    viewVehicleId,
    liveEnabled: onConnectedCar || unidentifiedLive,
    browsing: connected && !onConnectedCar && !unidentifiedLive,
  };
}
