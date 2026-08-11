/*
 * Validates the pbxproj mutation in withRecordingActivity.js against the app's
 * REAL ios/Type.xcodeproj/project.pbxproj — no Mac, no full prebuild.
 *
 * It parses the committed project in memory, adds the widget target, then
 * asserts the target/embed/dependency wiring and that the project still
 * serializes and re-parses. It never writes to the real project file.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const xcode = require("xcode");
const {
  addRustCoreLinkerFlagsToPodfile,
  addWidgetTarget,
  WIDGET_NAME,
} = require("../withRecordingActivity.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const PBXPROJ = path.join(here, "..", "..", "..", "..", "ios", "Type.xcodeproj", "project.pbxproj");
const APP_BUNDLE_ID = "com.typenotes.mobile";

const unquote = (v) => (typeof v === "string" ? v.replace(/^"(.*)"$/, "$1") : v);

const parse = () => {
  const proj = xcode.project(PBXPROJ);
  proj.parseSync();
  return proj;
};

const findTargetByName = (proj, name) =>
  Object.entries(proj.pbxNativeTargetSection())
    .filter(([k]) => !k.endsWith("_comment"))
    .map(([, v]) => v)
    .find((t) => t && unquote(t.name) === name);

describe("addWidgetTarget against the real project.pbxproj", () => {
  const proj = parse();
  const added = addWidgetTarget(proj, APP_BUNDLE_ID);

  it("reports it added the target", () => {
    expect(added).toBe(true);
  });

  it("creates a RecordingWidget app_extension target", () => {
    const target = findTargetByName(proj, WIDGET_NAME);
    expect(target).toBeTruthy();
    expect(target.productType).toBe('"com.apple.product-type.app-extension"');
  });

  it("sets INFOPLIST_FILE, bundle id and deployment target on both configs", () => {
    const target = findTargetByName(proj, WIDGET_NAME);
    const list = proj.pbxXCConfigurationList()[target.buildConfigurationList];
    const xcConfigs = proj.pbxXCBuildConfigurationSection();
    expect(list.buildConfigurations.length).toBeGreaterThanOrEqual(2);
    for (const ref of list.buildConfigurations) {
      const s = xcConfigs[ref.value].buildSettings;
      expect(s.INFOPLIST_FILE).toBe(`"${WIDGET_NAME}/Info.plist"`);
      expect(s.PRODUCT_BUNDLE_IDENTIFIER).toBe(`"${APP_BUNDLE_ID}.${WIDGET_NAME}"`);
      expect(s.IPHONEOS_DEPLOYMENT_TARGET).toBe("16.4");
    }
  });

  it("embeds the .appex via a PlugIns (spec 13) copy phase on the app target", () => {
    const phases = proj.hash.project.objects.PBXCopyFilesBuildPhase || {};
    const embedKey = Object.keys(phases)
      .filter((k) => !k.endsWith("_comment"))
      .find(
        (k) =>
          String(phases[k].dstSubfolderSpec) === "13" &&
          (phases[k].files || []).some((f) =>
            String(f.comment).includes(`${WIDGET_NAME}.appex`)
          )
      );
    expect(embedKey).toBeTruthy();
    const app = findTargetByName(proj, "Type");
    expect(app.buildPhases.some((bp) => bp.value === embedKey)).toBe(true);
  });

  it("embeds the appex exactly once (no duplicate copy phases)", () => {
    const phases = proj.hash.project.objects.PBXCopyFilesBuildPhase || {};
    const embedding = Object.keys(phases)
      .filter((k) => !k.endsWith("_comment"))
      .filter((k) =>
        (phases[k].files || []).some((f) =>
          String(f.comment).includes(`${WIDGET_NAME}.appex`)
        )
      );
    expect(embedding).toHaveLength(1);
  });

  it("makes the app depend on the widget target", () => {
    const deps = proj.hash.project.objects.PBXTargetDependency || {};
    const count = Object.keys(deps).filter((k) => !k.endsWith("_comment")).length;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it("serializes and re-parses (round-trip) with the target intact", () => {
    const text = proj.writeSync();
    expect(typeof text).toBe("string");
    const tmp = path.join(os.tmpdir(), "type-widget-roundtrip.pbxproj");
    fs.writeFileSync(tmp, text);
    const reparsed = xcode.project(tmp);
    reparsed.parseSync();
    expect(findTargetByName(reparsed, WIDGET_NAME)).toBeTruthy();
    fs.unlinkSync(tmp);
  });

  it("is idempotent on a second run", () => {
    expect(addWidgetTarget(proj, APP_BUNDLE_ID)).toBe(false);
  });
});

describe("addRustCoreLinkerFlagsToPodfile", () => {
  const generatedPodfile = `post_install do |installer|
    react_native_post_install(
      installer,
      config[:reactNativePath],
      :mac_catalyst_enabled => false,
      :ccache_enabled => ccache_enabled?(podfile_properties),
    )
  end`;

  it("adds zlib and iconv to the generated aggregate xcconfigs", () => {
    const patched = addRustCoreLinkerFlagsToPodfile(generatedPodfile);
    expect(patched).toContain("@typenotes/link-rust-system-libraries");
    expect(patched).toContain("['-lz', '-liconv']");
    expect(patched).toContain("Pods-Type.*.xcconfig");
  });

  it("is idempotent", () => {
    const once = addRustCoreLinkerFlagsToPodfile(generatedPodfile);
    expect(addRustCoreLinkerFlagsToPodfile(once)).toBe(once);
  });
});
