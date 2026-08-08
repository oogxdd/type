import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cmakePath = fileURLToPath(
  new URL("../android/CMakeLists.txt", import.meta.url),
);
const proguardPath = fileURLToPath(
  new URL("../android/proguard-rules.pro", import.meta.url),
);
const legacyResolution =
  "require.resolve('uniffi-bindgen-react-native/package.json')";
const exportedResolution =
  "require('path').join(require('path').resolve(require.resolve('uniffi-bindgen-react-native'), '../../../../'), 'package.json')";

let source = readFileSync(cmakePath, "utf8");
if (!source.includes(legacyResolution) && !source.includes(exportedResolution)) {
  throw new Error(`Unexpected UBRN CMake template in ${cmakePath}`);
}

source = source.replace(legacyResolution, exportedResolution);

if (!source.includes("find_library(ZLIB z)")) {
  source = source.replace(
    "find_library(LOGCAT log)",
    "find_library(LOGCAT log)\nfind_library(ZLIB z)",
  );
}
if (!source.includes("  ${ZLIB}\n  my_rust_lib")) {
  source = source.replace(
    "  ${LOGCAT}\n  my_rust_lib",
    "  ${LOGCAT}\n  ${ZLIB}\n  my_rust_lib",
  );
}

writeFileSync(cmakePath, source);

if (!existsSync(proguardPath)) {
  writeFileSync(
    proguardPath,
    "# No consumer ProGuard rules are required for the generated TypeCore module.\n",
  );
}
