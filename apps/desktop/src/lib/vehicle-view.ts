
export type VehicleViewInput = {
  connected: boolean;
  connectedVehicleId: number | null;
  selectedVehicleId: number | null;
  knownVehicleIds: number[];
};

export type VehicleView = {
  viewVehicleId: number | null;
  liveEnabled: boolean;
  browsing: boolean;
};

export function resolveVehicleView(input: VehicleViewInput): VehicleView {
  const { connected, connectedVehicleId, selectedVehicleId, knownVehicleIds } = input;
  const selectionValid = selectedVehicleId != null && knownVehicleIds.includes(selectedVehicleId);
  const viewVehicleId = selectionValid ? selectedVehicleId : (connectedVehicleId ?? knownVehicleIds[0] ?? null);
  const onConnectedCar = connected && connectedVehicleId != null && viewVehicleId === connectedVehicleId;
  const unidentifiedLive = connected && connectedVehicleId == null && viewVehicleId == null;
  return {
    viewVehicleId,
    liveEnabled: onConnectedCar || unidentifiedLive,
    browsing: connected && !onConnectedCar && !unidentifiedLive,
  };
}
