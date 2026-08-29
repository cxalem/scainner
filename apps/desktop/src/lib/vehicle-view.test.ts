import { describe, expect, it } from "vitest";
import { resolveVehicleView } from "./vehicle-view";

describe("resolveVehicleView", () => {
  const known = [1, 2, 3];

  it("shows the connected car with live controls when nothing else is selected", () => {
    expect(resolveVehicleView({ connected: true, connectedVehicleId: 2, selectedVehicleId: null, knownVehicleIds: known }))
      .toEqual({ viewVehicleId: 2, liveEnabled: true, browsing: false });
  });

  it("keeps live controls when the selection is the connected car", () => {
    expect(resolveVehicleView({ connected: true, connectedVehicleId: 2, selectedVehicleId: 2, knownVehicleIds: known }))
      .toEqual({ viewVehicleId: 2, liveEnabled: true, browsing: false });
  });

  it("disables live controls while browsing another vehicle", () => {
    expect(resolveVehicleView({ connected: true, connectedVehicleId: 2, selectedVehicleId: 3, knownVehicleIds: known }))
      .toEqual({ viewVehicleId: 3, liveEnabled: false, browsing: true });
  });

  it("never enables live controls while disconnected", () => {
    expect(resolveVehicleView({ connected: false, connectedVehicleId: null, selectedVehicleId: 3, knownVehicleIds: known }))
      .toEqual({ viewVehicleId: 3, liveEnabled: false, browsing: false });
    expect(resolveVehicleView({ connected: false, connectedVehicleId: null, selectedVehicleId: null, knownVehicleIds: known }))
      .toEqual({ viewVehicleId: 1, liveEnabled: false, browsing: false });
  });

  it("ignores a selection the database no longer knows", () => {
    expect(resolveVehicleView({ connected: true, connectedVehicleId: 2, selectedVehicleId: 9, knownVehicleIds: known }))
      .toEqual({ viewVehicleId: 2, liveEnabled: true, browsing: false });
  });

  it("keeps a connected, not yet identified car live until something else is browsed", () => {
    expect(resolveVehicleView({ connected: true, connectedVehicleId: null, selectedVehicleId: null, knownVehicleIds: [] }))
      .toEqual({ viewVehicleId: null, liveEnabled: true, browsing: false });
    expect(resolveVehicleView({ connected: true, connectedVehicleId: null, selectedVehicleId: 1, knownVehicleIds: known }))
      .toEqual({ viewVehicleId: 1, liveEnabled: false, browsing: true });
  });
});
