// <Grow>'s one layout invariant, pinned.
//
// The tests run in node and jsdom does no layout, so the only honest unit
// test for a flexbox squash is on the declaration that prevents it. The bug
// is real and shipped (Brief P, 2026-09-02): the device screen's Nearby group
// animated its height correctly and rendered at 0 px, because the animating
// box is a flex item in the card's scrolling column and a flex item whose
// overflow is not `visible` has an automatic minimum size of 0 — so a card
// already full of paired rows was free to shrink it back to nothing. The
// scanning row was in the DOM the whole time and never once on screen.
//
// The two properties belong together: whoever drops the shrink guard has to
// read why it is there first.
import { describe, expect, it } from "vitest";
import { growBoxStyle } from "./index";

describe("growBoxStyle", () => {
  it("clips its content, so an animated height reveals instead of squashing", () => {
    expect(growBoxStyle.overflow).toBe("hidden");
  });

  it("refuses to be shrunk, because clipping zeroes a flex item's minimum size", () => {
    expect(growBoxStyle.flexShrink).toBe(0);
  });
});
