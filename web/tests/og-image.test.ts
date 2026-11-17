import { readFileSync } from "node:fs";

import { OG_IMAGE } from "../src/lib/site-pages";

// The link preview image is drawn from the data package (npm run og-image); a new data
// release must come with a new image, or the preview would show numbers the site no longer has.
describe("the link preview image", () => {
  const image = readFileSync(`public${OG_IMAGE.path}`);
  const note = JSON.parse(readFileSync(`public${OG_IMAGE.path.replace(/\.png$/, ".json")}`, "utf8")) as {
    data_version: string;
    data_sha256: string;
  };
  const pointer = JSON.parse(readFileSync("../data-release.json", "utf8")) as {
    data_version: string;
    sha256: string;
  };

  it("was drawn from the data release the site uses", () => {
    expect(note.data_version, "run npm run og-image after updating data-release.json").toBe(pointer.data_version);
    expect(note.data_sha256).toBe(pointer.sha256);
  });

  it("is a PNG of the size the page announces", () => {
    expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect([image.readUInt32BE(16), image.readUInt32BE(20)]).toEqual([OG_IMAGE.width, OG_IMAGE.height]);
  });
});
