// A picture's width as it's drawn decides its file: the column's on a phone, narrower for a tall picture.
import assert from "node:assert/strict";
import { test } from "node:test";
import { optionSizes, overSizes } from "./sizes.ts";

const wide = { src: "", srcset: "", w: 1200, h: 900 };
const tall = { src: "", srcset: "", w: 800, h: 1200 };

test("the picture over a question is the column's width, or less where it's tall", () => {
  assert.equal(overSizes(wide, 390, 844), "358px"); // a phone: the column, 16px a side
  assert.equal(overSizes(wide, 1280, 800), "427px"); // a computer: two fifths of the height, at 4:3
  assert.equal(overSizes(tall, 390, 844), "225px"); // tall: two fifths of the height
  assert.equal(overSizes(tall, 1280, 1400), "373px");
});

test("a choice's picture is half the column, in a box five by three", () => {
  assert.equal(optionSizes(wide, 390), "127px"); // 4:3 in a box 5:3: its height fills the box
  assert.equal(optionSizes(tall, 390), "64px");
  assert.equal(optionSizes(wide, 1280), "227px");
});
