import { execSync } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { platform } from "os";
import { dirname, join } from "path";

const currentPlatform = platform();

function ensureOutputDir(outputPath) {
  const outputDir = dirname(outputPath);
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }
}

// Windows: Compile C# helper with Roslyn csc.exe from VS Build Tools
function buildWin32() {
  const source = "helpers/voiceroid-bridge/Program.cs";
  const output = "resources/voiceroid-bridge.exe";

  if (!existsSync(source)) {
    console.error(`[build-voiceroid-bridge] Source not found: ${source}`);
    process.exit(1);
  }

  ensureOutputDir(output);

  // Find Visual Studio installation using vswhere.exe
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const vswhere = join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe");

  if (!existsSync(vswhere)) {
    console.error("[build-voiceroid-bridge] vswhere.exe not found. Visual Studio Build Tools required.");
    process.exit(1);
  }

  let vsPath;
  try {
    console.log("[build-voiceroid-bridge] Querying Visual Studio installation...");
    vsPath = execSync(
      `"${vswhere}" -products * -latest -property installationPath -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64`,
      { encoding: "utf8" },
    ).trim();
    console.log(`[build-voiceroid-bridge] VS Path: ${vsPath}`);
  } catch {
    console.error("[build-voiceroid-bridge] Failed to find Visual Studio installation.");
    process.exit(1);
  }

  if (!vsPath) {
    console.error(
      '[build-voiceroid-bridge] Visual Studio Build Tools not found. Install with: winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"',
    );
    process.exit(1);
  }

  // Roslyn csc.exe is included with VS Build Tools MSBuild
  const cscPath = join(vsPath, "MSBuild", "Current", "Bin", "Roslyn", "csc.exe");
  if (!existsSync(cscPath)) {
    console.error(`[build-voiceroid-bridge] csc.exe not found at: ${cscPath}`);
    process.exit(1);
  }

  // vcvarsall.bat sets up the .NET Framework reference assembly paths
  const vcvarsall = join(vsPath, "VC", "Auxiliary", "Build", "vcvarsall.bat");
  if (!existsSync(vcvarsall)) {
    console.error(`[build-voiceroid-bridge] vcvarsall.bat not found: ${vcvarsall}`);
    process.exit(1);
  }

  // Locate UIAutomationClient.dll and UIAutomationTypes.dll from .NET Framework reference assemblies
  const refAsmBase = join(programFilesX86, "Reference Assemblies", "Microsoft", "Framework", ".NETFramework");
  const netVersions = ["v4.8", "v4.7.2", "v4.7.1", "v4.7", "v4.6.2", "v4.6.1", "v4.6"];
  let uiaClientDll = "";
  let uiaTypesDll = "";
  let windowsBaseDll = "";
  for (const ver of netVersions) {
    const candidate = join(refAsmBase, ver, "UIAutomationClient.dll");
    if (existsSync(candidate)) {
      uiaClientDll = join(refAsmBase, ver, "UIAutomationClient.dll");
      uiaTypesDll = join(refAsmBase, ver, "UIAutomationTypes.dll");
      windowsBaseDll = join(refAsmBase, ver, "WindowsBase.dll");
      console.log(`[build-voiceroid-bridge] Found UIAutomation refs: ${ver}`);
      break;
    }
  }
  if (!uiaClientDll) {
    console.error("[build-voiceroid-bridge] UIAutomationClient.dll not found in .NET Framework reference assemblies.");
    process.exit(1);
  }

  try {
    console.log("[build-voiceroid-bridge] Compiling C# helper with Roslyn csc.exe...");
    execSync(
      `cmd /c ""${vcvarsall}" x64 && "${cscPath}" /target:exe /platform:x64 /optimize+ /r:"${uiaClientDll}" /r:"${uiaTypesDll}" /r:"${windowsBaseDll}" /out:${output} ${source}"`,
      { stdio: "inherit" },
    );
    console.log(`[build-voiceroid-bridge] Built: ${output}`);
  } catch (error) {
    console.error("[build-voiceroid-bridge] Compilation failed:", error.message);
    process.exit(1);
  }
}

if (currentPlatform === "win32") {
  buildWin32();
} else {
  console.log(`[build-voiceroid-bridge] Skipping: Windows-only feature (${currentPlatform})`);
}
