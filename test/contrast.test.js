import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { luminance, contrastRatio, over, needs, shownRatio, hex } from '../src/client/contrast.js';

const WHITE = [255, 255, 255, 1];
const BLACK = [0, 0, 0, 1];
const near = (actual, expected, digits = 2) => assert.equal(actual.toFixed(digits), expected.toFixed(digits));

describe('Contrast, as WCAG measures it', () => {
  test('the ratio of two colours: 21:1 for black on white, 1:1 for one on itself, either way round', () => {
    near(luminance(WHITE), 1);
    near(luminance(BLACK), 0);
    near(contrastRatio(BLACK, WHITE), 21);
    near(contrastRatio(WHITE, BLACK), 21);
    near(contrastRatio([0x77, 0x77, 0x77], WHITE), 4.48);
    near(contrastRatio([0x76, 0x76, 0x76], WHITE), 4.54);
    near(contrastRatio([0x12, 0x34, 0x56], [0x12, 0x34, 0x56]), 1);
  });

  test('a colour with alpha over another shows their blend', () => {
    assert.deepEqual(over([0, 0, 0, 0.5], WHITE), [127.5, 127.5, 127.5, 1]);
    assert.deepEqual(over([255, 0, 0, 1], WHITE), [255, 0, 0, 1], 'opaque: itself');
    assert.deepEqual(over([0, 0, 0, 0], [10, 20, 30, 1]), [10, 20, 30, 1], 'transparent: what is under it');
    const halves = over([0, 0, 0, 0.5], [255, 255, 255, 0.5]); // two translucent layers stay translucent
    near(halves[3], 0.75);
    near(halves[0], 85);
  });

  test('AA asks 4.5:1 of text, 3:1 of large text: 24 px, or 18.66 px and bold', () => {
    assert.equal(needs('16px', '400'), 4.5);
    assert.equal(needs('24px', '400'), 3);
    assert.equal(needs('18.66px', '700'), 3);
    assert.equal(needs('18.66px', '600'), 4.5);
    assert.equal(needs('18px', 'bold'), 4.5, 'too small, bold or not');
  });

  test('the report rounds a ratio down, so one under what it needs never reads as enough', () => {
    assert.equal(shownRatio(4.47), 4.4);
    assert.equal(shownRatio(2.999), 2.9);
    assert.equal(shownRatio(3), 3);
    assert.equal(hex([255, 127.5, 0]), '#ff8000');
  });
});
