import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { styleUrls } from '../src/client/picture.js';

// What a picture's reader gives for a file: its data: URL ('' when it can't be read), each read noted
function reader(unreadable = []) {
  const read = [];
  return {
    read,
    dataUrl(url) {
      read.push(url);
      return Promise.resolve(unreadable.includes(url) ? '' : `data:image/png;base64,${Buffer.from(url).toString('base64')}`);
    },
  };
}

describe('A picture holds each file inline styles use once', () => {
  const base = 'http://localhost:3000/designs/a.html';

  test('the elements share a custom property per file, read once', async () => {
    const files = reader();
    const vars = new Map();
    const first = await styleUrls("background-image: url('../assets/thumb.png'); left: 0", base, files, vars);
    const second = await styleUrls('background: url("/assets/thumb.png") center / cover, url(dots.svg)', base, files, vars);
    assert.equal(first, 'background-image: var(--htmlboard-file-1); left: 0');
    assert.equal(second, 'background: var(--htmlboard-file-1) center / cover, var(--htmlboard-file-2)');
    assert.deepEqual([...vars.keys()], ['http://localhost:3000/assets/thumb.png', 'http://localhost:3000/designs/dots.svg']);
    assert.deepEqual(files.read, [...vars.keys()]);
    assert.match(vars.get('http://localhost:3000/assets/thumb.png').data, /^data:image\/png;base64,/);
  });

  test('a hundred elements with one image: one copy of it', async () => {
    const files = reader();
    const vars = new Map();
    const styles = await Promise.all(Array.from({ length: 100 }, (_, i) => styleUrls(`left: ${i}px; background-image: url(../shot.png)`, base, files, vars)));
    assert.equal(vars.size, 1);
    assert.equal(files.read.length, 1);
    assert.ok(styles.every((style, i) => style === `left: ${i}px; background-image: var(--htmlboard-file-1)`));
  });

  test('data: URLs and fragments stay as they are; a file that can\'t be read holds nothing', async () => {
    const files = reader(['http://localhost:3000/designs/gone.png']);
    const vars = new Map();
    const style = await styleUrls('mask: url(#shape); background: url(data:image/gif;base64,R0lGOD), url(gone.png)', base, files, vars);
    assert.equal(style, 'mask: url(#shape); background: url(data:image/gif;base64,R0lGOD), var(--htmlboard-file-1)');
    assert.equal(vars.get('http://localhost:3000/designs/gone.png').data, '');
  });
});
