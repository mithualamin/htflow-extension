import * as vscode from "vscode";
import { HTFlowSidebarProvider } from "./sidebarProvider";
import { exec } from "child_process";

let currentPanel: vscode.WebviewPanel | undefined = undefined;
let statusBarItem: vscode.StatusBarItem;
let rocketDecorationType: vscode.TextEditorDecorationType;
let minimapDecorationEnabled: boolean = true;
let sidebarProvider: HTFlowSidebarProvider;

// Function to handle CLI installation
async function handleCLIInstallation() {
  const terminal = vscode.window.createTerminal({
    name: "HTFlow CLI Installation",
    cwd: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });

  terminal.show();
  terminal.sendText("npm install -g htflow-cli");

  vscode.window
    .showInformationMessage(
      "Installing HTFlow CLI... Check the terminal for progress.",
      "Open Terminal"
    )
    .then((selection) => {
      if (selection === "Open Terminal") {
        terminal.show();
      }
    });

  // Wait a bit and then check status
  setTimeout(() => {
    checkCLIStatus(currentPanel);
  }, 5000);
}

// Function to check CLI installation status
function checkCLIStatus(panel?: vscode.WebviewPanel) {
  exec("npx htflow --version", (error, stdout, stderr) => {
    const isInstalled = !error;
    const version = isInstalled ? stdout.trim() : null;

    if (panel) {
      panel.webview.postMessage({
        type: "cliStatus",
        data: {
          installed: isInstalled,
          version: version,
          error: error?.message,
        },
      });
    }

    if (isInstalled) {
      vscode.window.showInformationMessage(
        `HTFlow CLI is installed! Version: ${version}`
      );
    } else {
      vscode.window.showWarningMessage(
        "HTFlow CLI is not installed or not found in PATH"
      );
    }
  });
}

// Function to create HTFlow rocket decorations
function createRocketDecoration(
  context: vscode.ExtensionContext
): vscode.TextEditorDecorationType {
  const rocketIconPath = vscode.Uri.joinPath(
    context.extensionUri,
    "media",
    "htflow-rocket-minimap.svg"
  );

  return vscode.window.createTextEditorDecorationType({
    gutterIconPath: rocketIconPath,
    gutterIconSize: "contain",
    overviewRulerColor: "#FF6B35",
    overviewRulerLane: vscode.OverviewRulerLane.Right,
    before: {
      contentIconPath: rocketIconPath,
      margin: "0 4px 0 0",
      width: "16px",
      height: "16px",
    },
    // Use background color for minimap visibility
    backgroundColor: "rgba(255, 107, 53, 0.2)",
    // Add a border for better visibility
    border: "1px solid rgba(255, 107, 53, 0.3)",
  });
}

// Function to find HTFlow-related lines in the active editor
function findHTFlowLines(document: vscode.TextDocument): vscode.Range[] {
  const ranges: vscode.Range[] = [];
  const htflowPatterns = [
    /data-ht-/i, // HTFlow data attributes
    /ht-/i, // HTFlow classes
    /htflow/i, // HTFlow comments or references
    /@htflow/i, // HTFlow directives
    /<!-- HTFlow/i, // HTFlow HTML comments
    /HTFlow/i, // HTFlow mentions
  ];

  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber++) {
    const line = document.lineAt(lineNumber);
    const text = line.text;

    // Check if line matches any HTFlow pattern
    for (const pattern of htflowPatterns) {
      if (pattern.test(text)) {
        ranges.push(new vscode.Range(lineNumber, 0, lineNumber, text.length));
        break; // Only add each line once
      }
    }
  }

  return ranges;
}

// Function to update minimap decorations
function updateMinimapDecorations() {
  if (!minimapDecorationEnabled || !rocketDecorationType) {
    return;
  }

  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    return;
  }

  const document = activeEditor.document;

  // Only apply decorations to relevant file types
  const supportedLanguages = [
    "html",
    "css",
    "javascript",
    "typescript",
    "json",
    "markdown",
  ];
  if (!supportedLanguages.includes(document.languageId)) {
    return;
  }

  const htflowRanges = findHTFlowLines(document);
  activeEditor.setDecorations(rocketDecorationType, htflowRanges);
}

// Function to toggle minimap decorations
function toggleMinimapDecorations() {
  minimapDecorationEnabled = !minimapDecorationEnabled;

  if (minimapDecorationEnabled) {
    updateMinimapDecorations();
    vscode.window.showInformationMessage(
      "HTFlow minimap decorations enabled 🚀"
    );
  } else {
    // Clear all decorations
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && rocketDecorationType) {
      activeEditor.setDecorations(rocketDecorationType, []);
    }
    vscode.window.showInformationMessage("HTFlow minimap decorations disabled");
  }

  // Update configuration
  vscode.workspace
    .getConfiguration("htflow")
    .update(
      "minimapDecorations",
      minimapDecorationEnabled,
      vscode.ConfigurationTarget.Global
    );
}

// CSS injection is not possible in VS Code extensions for security reasons.
// File icons are handled through the icon theme system in package.json instead.

export function activate(context: vscode.ExtensionContext) {
  console.log("HTFlow extension is now active!");

  // Create and register the sidebar provider
  sidebarProvider = new HTFlowSidebarProvider(context.extensionUri);

  // Initialize minimap decorations
  rocketDecorationType = createRocketDecoration(context);
  minimapDecorationEnabled = vscode.workspace
    .getConfiguration("htflow")
    .get("minimapDecorations", true);

  // Create status bar item (toolbar icon)
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.text = "HTFlow";
  statusBarItem.tooltip = "Click to open HTFlow panel";
  statusBarItem.command = "htflow.togglePanel";
  // Remove warning background color for cleaner appearance
  // statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);

  // Note: CSS injection is not possible in VS Code for security reasons
  // File icons are handled by the icon theme system instead

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("htflow.sidebar", sidebarProvider)
  );

  // Register command to open sidebar (left side)
  const openSidebarCommand = vscode.commands.registerCommand(
    "htflow.openSidebar",
    () => {
      vscode.commands.executeCommand("workbench.view.extension.htflow-sidebar");
    }
  );

  // Register command to open as a panel on the right side
  const openRightPanelCommand = vscode.commands.registerCommand(
    "htflow.openRightPanel",
    () => {
      // Create or reveal the panel on the right side
      const columnToShowIn = vscode.ViewColumn.Two; // This opens it on the right

      if (currentPanel) {
        // If we already have a panel, reveal it
        currentPanel.reveal(columnToShowIn);
      } else {
        // Create a new panel
        currentPanel = vscode.window.createWebviewPanel(
          "htflowPanel",
          "HTFlow",
          columnToShowIn,
          {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [context.extensionUri],
          }
        );

        // Set the panel's HTML content
        currentPanel.webview.html = sidebarProvider._getHtmlForWebview(
          currentPanel.webview
        );

        // Attach unified message handler so CLI buttons work in this panel too
        sidebarProvider.attachMessageHandler(currentPanel.webview);

        // Set the current panel reference for audit results
        sidebarProvider.currentPanel = currentPanel;

        // Reset when the panel is closed
        currentPanel.onDidDispose(
          () => {
            currentPanel = undefined;
            sidebarProvider.currentPanel = undefined;
          },
          undefined,
          context.subscriptions
        );
      }
    }
  );

  // Register toggle command (for the status bar button)
  const togglePanelCommand = vscode.commands.registerCommand(
    "htflow.togglePanel",
    () => {
      if (currentPanel) {
        // If panel is already open, just focus it
        currentPanel.reveal(vscode.ViewColumn.Two);
      } else {
        // Open the panel on the right side by default
        vscode.commands.executeCommand("htflow.openRightPanel");
      }
    }
  );

  // Register command to toggle minimap decorations
  const toggleMinimapCommand = vscode.commands.registerCommand(
    "htflow.toggleMinimapDecorations",
    toggleMinimapDecorations
  );

  // Register command to activate HTFlow icon theme
  const activateIconThemeCommand = vscode.commands.registerCommand(
    "htflow.activateIconTheme",
    async () => {
      try {
        await vscode.workspace
          .getConfiguration()
          .update(
            "workbench.iconTheme",
            "htflow-icons",
            vscode.ConfigurationTarget.Global
          );

        const action = await vscode.window.showInformationMessage(
          "HTFlow icon theme activated! The theme is now active and will show HTFlow icons for .htflow files.",
          "Open HTFlow File",
          "Create Test File"
        );

        if (action === "Create Test File") {
          // Create a test .htflow file to demonstrate the icon
          const testContent = `<!-- HTFlow Test File -->
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>HTFlow Test</title>
    <style data-ht-styles>
        .hero-section { padding: 40px; }
    </style>
</head>
<body>
    <div class="htflow-wrapper">
        <h1 class="hero-title">HTFlow Test</h1>
    </div>
</body>
</html>`;

          const doc = await vscode.workspace.openTextDocument({
            content: testContent,
            language: "html",
          });

          await vscode.window.showTextDocument(doc);

          // Suggest saving as .htflow file
          vscode.window.showInformationMessage(
            "Save this file with a .htflow extension to see the HTFlow icon!"
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to activate HTFlow icon theme: ${error}`
        );
      }
    }
  );

  // Set up event listeners for decoration updates
  const activeEditorChangeListener = vscode.window.onDidChangeActiveTextEditor(
    () => {
      updateMinimapDecorations();
    }
  );

  const textDocumentChangeListener = vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (
        vscode.window.activeTextEditor &&
        event.document === vscode.window.activeTextEditor.document
      ) {
        // Debounce the updates to avoid too frequent decoration changes
        setTimeout(() => {
          updateMinimapDecorations();
        }, 500);
      }
    }
  );

  // Initial decoration update
  updateMinimapDecorations();

  context.subscriptions.push(
    openSidebarCommand,
    openRightPanelCommand,
    togglePanelCommand,
    toggleMinimapCommand,
    activateIconThemeCommand,
    activeEditorChangeListener,
    textDocumentChangeListener,
    rocketDecorationType
  );

  // Show a simple notification that the extension is ready
  vscode.window.showInformationMessage(
    "HTFlow is ready! Click the HTFlow button in the status bar to open the panel."
  );
}

export function deactivate() {
  console.log("HTFlow extension deactivated");

  // Clean up sidebar provider and file watcher
  if (sidebarProvider) {
    sidebarProvider.dispose();
  }
}
