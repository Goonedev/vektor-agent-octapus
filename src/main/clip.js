'use strict';

/*
 * Clipboard access that works across Electron versions: older releases expose synchronous
 * readText/readImage/writeImage, Electron 44+ only the async W3C-style read/write API.
 */

const { clipboard, nativeImage } = require('electron');
const electron = require('electron');

async function readText() {
  return (await clipboard.readText()) || '';
}

async function writeText(text) {
  await clipboard.writeText(String(text ?? ''));
}

async function readImage() {
  if (typeof clipboard.readImage === 'function') return clipboard.readImage();
  const items = await clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (!type) continue;
    const blob = await item.getType(type);
    return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
  }
  return nativeImage.createEmpty();
}

async function writeImage(image) {
  if (typeof clipboard.writeImage === 'function') return clipboard.writeImage(image);
  const blob = new Blob([image.toPNG()], { type: 'image/png' });
  await clipboard.write([new electron.ClipboardItem({ 'image/png': blob })]);
}

async function clear() {
  await clipboard.clear();
}

module.exports = { readText, writeText, readImage, writeImage, clear };
