import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

type RunningServer = {
  port: number;
  mode: string;
  folder: string;
  startTime: Date;
  terminal: vscode.Terminal;
  origin: "browser" | "sidebar";
};

export class HTFlowSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _browserPanel?: vscode.WebviewPanel;
  private _fileWatcher?: vscode.FileSystemWatcher;
  private _runningServers: Map<string, RunningServer> = new Map();
  private _terminals: Map<string, vscode.Terminal> = new Map();
  private _currentPanel?: vscode.WebviewPanel;
  private _browserLiveServerId?: string;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this.setupFileWatcher();
  }

  get webviewView(): vscode.WebviewView | undefined {
    return this._view;
  }

  get currentPanel(): vscode.WebviewPanel | undefined {
    return this._currentPanel;
  }

  set currentPanel(panel: vscode.WebviewPanel | undefined) {
    this._currentPanel = panel;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
      enableCommandUris: true,
      portMapping: [],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      try {
        console.log("HTFlow: ===== NEW MESSAGE RECEIVED =====");
        console.log(
          "HTFlow received message:",
          JSON.stringify(message, null, 2)
        );
        console.log("HTFlow message command:", message.command);
        console.log("HTFlow message type:", message.type);
        console.log("HTFlow: Processing message...");
        switch (message.command) {
          case "ready":
            console.log("HTFlow panel is ready");
            vscode.window.showInformationMessage(
              "HTFlow panel loaded successfully!"
            );
            break;

          case "openBrowserPanel":
            this.openBrowserPanel();
            break;

          case "htflow.init":
            await this.executeHTFlowCommandForPanel(
              "init",
              "HTFlow project initialized successfully!"
            );
            break;

          case "htflow.validate":
            await this.executeHTFlowCommandForPanel(
              "validate",
              "Validation completed successfully!"
            );
            break;

          case "htflow.audit":
            if (message.displayInPanel) {
              await this.executeHTFlowAuditForPanel(
                message.folder,
                "Audit completed successfully!"
              );
            } else {
              await this.executeHTFlowCommandWithFolder(
                "audit",
                message.folder,
                "Audit completed successfully!"
              );
            }
            break;

          case "refreshWorkspace":
            vscode.commands.executeCommand("workbench.action.reloadWindow");
            break;

          case "openFile":
            if (message.path) {
              const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
              if (workspaceFolder) {
                const fullPath = path.join(
                  workspaceFolder.uri.fsPath,
                  message.path
                );
                await vscode.commands.executeCommand(
                  "vscode.open",
                  vscode.Uri.file(fullPath)
                );
              }
            }
            break;

          case "startLiveServer":
            await this.startHTFlowServer(
              message.port || 3000,
              "dev",
              undefined,
              "browser",
              false
            );
            break;

          case "toolAction":
            await this.handleToolAction(message.tool);
            break;

          case "settingChange":
            await this.handleSettingChange(message.setting, message.value);
            break;

          case "validateFile":
            if (message.path) {
              await this.validateSpecificFile(message.path);
            }
            break;

          // HTFlow CLI Commands
          case "htflow.audit.html":
            await this.executeHTFlowCommandForPanel(
              "audit --html",
              "HTML audit report generated successfully!"
            );
            break;

          case "htflow.build":
            await this.executeHTFlowCommandForPanel(
              "build",
              "Project built successfully!"
            );
            break;

          case "htflow.serve.dev":
            const devPort = message.port ? Number(message.port) : 3050;
            console.log(
              `HTFlow: Dev server requested with port: ${
                message.port
              } (type: ${typeof message.port}), converted: ${devPort}`
            );
            const hasUserDevPort =
              message.port && message.port.toString().trim() !== "";
            console.log(`HTFlow: User specified dev port: ${hasUserDevPort}`);
            await this.startHTFlowServer(
              devPort,
              "dev",
              message.folder,
              "sidebar",
              hasUserDevPort
            );
            break;

          case "htflow.serve.prod":
            const prodPort = message.port ? Number(message.port) : 3051;
            console.log(
              `HTFlow: Prod server requested with port: ${
                message.port
              } (type: ${typeof message.port}), converted: ${prodPort}`
            );
            const hasUserProdPort =
              message.port && message.port.toString().trim() !== "";
            console.log(`HTFlow: User specified prod port: ${hasUserProdPort}`);
            await this.startHTFlowServer(
              prodPort,
              "start",
              message.folder,
              "sidebar",
              hasUserProdPort
            );
            break;

          case "htflow.serve.custom":
            await this.startHTFlowServer(
              message.port || 3000,
              "dev",
              undefined,
              "sidebar",
              false
            );
            break;

          case "htflow.version":
            await this.executeHTFlowCommandForPanel(
              "version",
              "HTFlow version checked successfully!"
            );
            break;

          // MCP Commands
          case "htflow.mcp-install":
            await this.executeHTFlowCommandForPanel(
              "mcp-install",
              "MCP configuration installed successfully!"
            );
            break;

          case "htflow.mcp-uninstall":
            await this.executeHTFlowCommandForPanel(
              "mcp-uninstall",
              "MCP configuration uninstalled successfully!"
            );
            break;

          case "htflow.mcp-status":
            await this.executeHTFlowCommandForPanel(
              "mcp-status",
              "MCP status checked successfully!"
            );
            break;

          // NPM Commands
          case "npm.install":
            await this.executeNpmCommand(
              "install -g htflow-cli",
              "HTFlow CLI installed successfully!"
            );
            break;

          case "npm.update":
            await this.executeNpmCommand(
              "install -g htflow-cli@latest",
              "HTFlow CLI updated successfully!"
            );
            break;

          case "npm.uninstall":
            await this.executeNpmCommand(
              "uninstall -g htflow-cli",
              "HTFlow CLI uninstalled successfully!"
            );
            break;

          case "stopServer":
            await this.stopServer(message.serverId, message.port);
            break;

          case "openUrl":
            if (message.url) {
              await vscode.commands.executeCommand(
                "vscode.open",
                vscode.Uri.parse(message.url)
              );
            }
            break;

          case "openExternal":
            if (message.url) {
              await vscode.env.openExternal(vscode.Uri.parse(message.url));
            }
            break;

          case "openIndexInBrowser":
            await this.openIndexInBrowser();
            break;

          default:
            vscode.window.showInformationMessage(`HTFlow: ${message.command}`);
            break;
        }
      } catch (error) {
        console.error("HTFlow: ===== ERROR PROCESSING MESSAGE =====");
        console.error("HTFlow command error:", error);
        console.error(
          "HTFlow error stack:",
          error instanceof Error ? error.stack : "No stack"
        );
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`HTFlow Error: ${errorMessage}`);
        console.error("HTFlow: ===== END ERROR =====");
      }
    });
  }

  // Attach the same message handling logic to any webview (e.g., right-side WebviewPanel)
  public attachMessageHandler(webview: vscode.Webview) {
    webview.onDidReceiveMessage(async (message) => {
      try {
        console.log("HTFlow: ===== NEW MESSAGE RECEIVED =====");
        console.log(
          "HTFlow received message:",
          JSON.stringify(message, null, 2)
        );
        console.log("HTFlow message command:", message.command);
        console.log("HTFlow message type:", message.type);
        console.log("HTFlow: Processing message (panel)...");

        switch (message.command) {
          case "ready":
            console.log("HTFlow panel is ready (panel)");
            vscode.window.showInformationMessage(
              "HTFlow panel loaded successfully!"
            );
            break;

          case "openBrowserPanel":
            this.openBrowserPanel();
            break;

          case "htflow.init":
            await this.executeHTFlowCommandForPanel(
              "init",
              "HTFlow project initialized successfully!"
            );
            break;

          case "htflow.validate":
            await this.executeHTFlowCommandForPanel(
              "validate",
              "Validation completed successfully!"
            );
            break;

          case "htflow.audit":
            if (message.displayInPanel) {
              await this.executeHTFlowAuditForPanel(
                message.folder,
                "Audit completed successfully!"
              );
            } else {
              await this.executeHTFlowCommandWithFolder(
                "audit",
                message.folder,
                "Audit completed successfully!"
              );
            }
            break;

          case "refreshWorkspace":
            vscode.commands.executeCommand("workbench.action.reloadWindow");
            break;

          case "openFile":
            if (message.path) {
              const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
              if (workspaceFolder) {
                const fullPath = path.join(
                  workspaceFolder.uri.fsPath,
                  message.path
                );
                await vscode.commands.executeCommand(
                  "vscode.open",
                  vscode.Uri.file(fullPath)
                );
              }
            }
            break;

          case "startLiveServer":
            await this.startHTFlowServer(
              message.port || 3000,
              "dev",
              undefined,
              "browser",
              false
            );
            break;

          case "toolAction":
            await this.handleToolAction(message.tool);
            break;

          case "settingChange":
            await this.handleSettingChange(message.setting, message.value);
            break;

          case "validateFile":
            if (message.path) {
              await this.validateSpecificFile(message.path);
            }
            break;

          // HTFlow CLI Commands
          case "htflow.audit.html":
            await this.executeHTFlowCommandForPanel(
              "audit --html",
              "HTML audit report generated successfully!"
            );
            break;

          case "htflow.build":
            await this.executeHTFlowCommandForPanel(
              "build",
              "Project built successfully!"
            );
            break;

          case "htflow.serve.dev":
            const devPort = message.port ? Number(message.port) : 3050;
            console.log(
              `HTFlow: Dev server requested with port: ${
                message.port
              } (type: ${typeof message.port}), converted: ${devPort}`
            );
            const hasUserDevPort =
              message.port && message.port.toString().trim() !== "";
            console.log(`HTFlow: User specified dev port: ${hasUserDevPort}`);
            await this.startHTFlowServer(
              devPort,
              "dev",
              message.folder,
              "sidebar",
              hasUserDevPort
            );
            break;

          case "htflow.serve.prod":
            const prodPort = message.port ? Number(message.port) : 3051;
            console.log(
              `HTFlow: Prod server requested with port: ${
                message.port
              } (type: ${typeof message.port}), converted: ${prodPort}`
            );
            const hasUserProdPort =
              message.port && message.port.toString().trim() !== "";
            console.log(`HTFlow: User specified prod port: ${hasUserProdPort}`);
            await this.startHTFlowServer(
              prodPort,
              "start",
              message.folder,
              "sidebar",
              hasUserProdPort
            );
            break;

          case "htflow.serve.custom":
            await this.startHTFlowServer(
              message.port || 3000,
              "dev",
              undefined,
              "sidebar",
              false
            );
            break;

          case "htflow.version":
            await this.executeHTFlowCommandForPanel(
              "version",
              "HTFlow version checked successfully!"
            );
            break;

          // MCP Commands
          case "htflow.mcp-install":
            await this.executeHTFlowCommandForPanel(
              "mcp-install",
              "MCP configuration installed successfully!"
            );
            break;

          case "htflow.mcp-uninstall":
            await this.executeHTFlowCommandForPanel(
              "mcp-uninstall",
              "MCP configuration uninstalled successfully!"
            );
            break;

          case "htflow.mcp-status":
            await this.executeHTFlowCommandForPanel(
              "mcp-status",
              "MCP status checked successfully!"
            );
            break;

          // NPM Commands
          case "npm.install":
            await this.executeNpmCommand(
              "install -g htflow-cli",
              "HTFlow CLI installed successfully!"
            );
            break;

          case "npm.update":
            await this.executeNpmCommand(
              "install -g htflow-cli@latest",
              "HTFlow CLI updated successfully!"
            );
            break;

          case "npm.uninstall":
            await this.executeNpmCommand(
              "uninstall -g htflow-cli",
              "HTFlow CLI uninstalled successfully!"
            );
            break;

          case "stopServer":
            await this.stopServer(message.serverId, message.port);
            break;

          case "openUrl":
            if (message.url) {
              await vscode.commands.executeCommand(
                "vscode.open",
                vscode.Uri.parse(message.url)
              );
            }
            break;

          case "openExternal":
            if (message.url) {
              await vscode.env.openExternal(vscode.Uri.parse(message.url));
            }
            break;

          case "openIndexInBrowser":
            await this.openIndexInBrowser();
            break;

          default:
            vscode.window.showInformationMessage(`HTFlow: ${message.command}`);
            break;
        }
      } catch (error) {
        console.error("HTFlow: ===== ERROR PROCESSING MESSAGE (panel) =====");
        console.error("HTFlow command error:", error);
        console.error(
          "HTFlow error stack:",
          error instanceof Error ? error.stack : "No stack"
        );
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`HTFlow Error: ${errorMessage}`);
        console.error("HTFlow: ===== END ERROR (panel) =====");
      }
    });
  }

  private async openBrowserPanel() {
    // Close existing browser panel if it exists
    if (this._browserPanel) {
      this._browserPanel.dispose();
    }

    // Create a new webview panel for the browser
    const panel = vscode.window.createWebviewPanel(
      "htflowBrowser",
      "HTFlow Live Preview Browser",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [this._extensionUri],
        retainContextWhenHidden: true,
        enableCommandUris: true,
        portMapping: [],
      }
    );

    // Store the panel reference for file change notifications
    this._browserPanel = panel;

    // Handle panel disposal
    panel.onDidDispose(() => {
      this._browserPanel = undefined;
      console.log("HTFlow: Browser panel disposed");
    });

    // Set the HTML content for the browser panel
    panel.webview.html = this._getBrowserHtmlForWebview(panel.webview);

    // Handle messages from the browser panel
    panel.webview.onDidReceiveMessage(async (message) => {
      try {
        switch (message.command) {
          case "browserReady":
            console.log("HTFlow browser panel is ready");
            if (this._browserLiveServerId) {
              const runningServer = this._runningServers.get(
                this._browserLiveServerId
              );

              if (runningServer) {
                this.ensureBrowserPortMapping(runningServer.port);
                panel.webview.postMessage({
                  command: "liveServerStarted",
                  port: runningServer.port,
                  serverId: this._browserLiveServerId,
                  mode: runningServer.mode,
                });
              } else {
                this._browserLiveServerId = undefined;
                panel.webview.postMessage({ command: "liveServerStopped" });
              }
            } else {
              panel.webview.postMessage({ command: "liveServerStopped" });
            }
            break;

          case "startLiveServer":
            try {
              const parsedPort = Number(message.port);
              const requestedPort = Number.isFinite(parsedPort)
                ? Math.max(1, Math.min(65535, Math.floor(parsedPort)))
                : 3000;
              const requestedMode =
                typeof message.mode === "string" && message.mode.trim()
                  ? message.mode.trim()
                  : "dev";
              const result = await this.startHTFlowServer(
                requestedPort,
                requestedMode,
                message.folder,
                "browser",
                true // Browser panel always specifies port
              );

              if (result) {
                const { serverId, server } = result;
                panel.webview.postMessage({
                  command: "liveServerStarted",
                  port: server.port,
                  serverId,
                  mode: server.mode,
                });
              } else {
                panel.webview.postMessage({
                  command: "liveServerError",
                  error: `Failed to start HTFlow server on port ${requestedPort}`,
                });
              }
            } catch (err) {
              const errorMessage =
                err instanceof Error ? err.message : String(err);
              panel.webview.postMessage({
                command: "liveServerError",
                error: errorMessage,
              });
            }
            break;

          case "stopLiveServer":
            try {
              const parsedPort = Number(message.port);
              const resolvedPort = Number.isFinite(parsedPort)
                ? Math.max(1, Math.min(65535, Math.floor(parsedPort)))
                : undefined;
              const candidateId: string | undefined =
                (typeof message.serverId === "string" && message.serverId) ||
                this._browserLiveServerId ||
                (typeof resolvedPort === "number"
                  ? this.findRunningServerByPort(resolvedPort)?.serverId
                  : undefined);

              if (!candidateId) {
                panel.webview.postMessage({
                  command: "liveServerError",
                  error: "No active HTFlow live server to stop",
                });
                break;
              }

              const stopped = await this.stopServer(candidateId, resolvedPort);
              if (!stopped) {
                panel.webview.postMessage({
                  command: "liveServerError",
                  error: "Unable to stop the HTFlow live server",
                });
              }
            } catch (err) {
              const errorMessage =
                err instanceof Error ? err.message : String(err);
              panel.webview.postMessage({
                command: "liveServerError",
                error: errorMessage,
              });
            }
            break;

          case "openFileInBrowser":
            if (message.path) {
              const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
              if (workspaceFolder) {
                const fullPath = path.join(
                  workspaceFolder.uri.fsPath,
                  message.path
                );
                // Convert to a webview-safe URI instead of using file://
                const webviewUri = panel.webview.asWebviewUri(
                  vscode.Uri.file(fullPath)
                );
                // Send URL back to browser panel
                panel.webview.postMessage({
                  command: "openUrl",
                  url: webviewUri.toString(),
                });
              }
            }
            break;

          case "openExternal":
            if (message.url) {
              await vscode.env.openExternal(vscode.Uri.parse(message.url));
            }
            break;

          case "openIndexInBrowser":
            await this.openIndexInBrowser();
            break;

          case "openDeveloperTools":
            console.log("HTFlow: Opening Developer Tools...");
            try {
              // Try different VS Code dev tools commands
              const commands = [
                "workbench.action.toggleDevTools",
                "workbench.debug.action.toggleRepl",
                "workbench.action.webview.openDeveloperTools",
                "workbench.action.toggleDevTools",
              ];

              let commandExecuted = false;
              for (const cmd of commands) {
                try {
                  await vscode.commands.executeCommand(cmd);
                  console.log(`HTFlow: Command ${cmd} executed successfully`);
                  commandExecuted = true;
                  break;
                } catch (cmdError) {
                  console.log(`HTFlow: Command ${cmd} failed:`, cmdError);
                }
              }

              if (!commandExecuted) {
                // Fallback: Show instructions
                vscode.window.showInformationMessage(
                  "Developer Tools: Press Cmd+Option+I (Mac) or Ctrl+Shift+I (Windows/Linux) to open VS Code Developer Tools",
                  "Got it"
                );
              } else {
                // Show success message
                setTimeout(() => {
                  vscode.window
                    .showInformationMessage(
                      "Developer Tools should be open now! If not visible, try Help > Toggle Developer Tools",
                      "Open Help Menu"
                    )
                    .then((selection) => {
                      if (selection === "Open Help Menu") {
                        vscode.commands.executeCommand(
                          "workbench.action.showCommands"
                        );
                      }
                    });
                }, 500);
              }
            } catch (error) {
              console.error("HTFlow: Failed to open Developer Tools:", error);
              vscode.window.showErrorMessage(
                "Failed to open Developer Tools. Try Help > Toggle Developer Tools manually or press Cmd+Option+I (Mac) / Ctrl+Shift+I (Windows/Linux)."
              );
            }
            break;

          default:
            console.log("Browser panel message:", message);
            break;
        }
      } catch (error) {
        console.error("Browser panel command error:", error);
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Browser Panel Error: ${errorMessage}`);
      }
    });
  }

  public _getHtmlForWebview(webview: vscode.Webview) {
    const nonce = getNonce();

    // Read the modern HTML file
    const htmlPath = path.join(this._extensionUri.fsPath, "htflow-panel.html");

    try {
      let htmlContent = fs.readFileSync(htmlPath, "utf8");

      // Update Content Security Policy for VS Code - more permissive to avoid service worker issues
      htmlContent = htmlContent.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        `<meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-inline'; font-src ${webview.cspSource} https: data:; connect-src https: http: ws: wss:; img-src ${webview.cspSource} https: data: blob:; worker-src 'none'; child-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';">`
      );

      // Add service worker prevention and nonce to script tags
      htmlContent = htmlContent.replace(
        "<script>",
        `<script nonce="${nonce}">
          // Aggressive service worker prevention for VS Code webview
          (function() {
            // Block service worker registration completely
            if ('serviceWorker' in navigator) {
              try {
                Object.defineProperty(navigator, 'serviceWorker', {
                  get: () => {
                    console.log('HTFlow: Service worker access blocked');
                    return undefined;
                  },
                  set: () => {},
                  configurable: false,
                  enumerable: false
                });
              } catch(e) {
                console.log('HTFlow: Could not redefine serviceWorker property');
              }
            }
            
            // Block service worker constructor if it exists
            if (typeof ServiceWorker !== 'undefined') {
              window.ServiceWorker = undefined;
            }
            
            // Block service worker registration method
            if (typeof ServiceWorkerRegistration !== 'undefined') {
              window.ServiceWorkerRegistration = undefined;
            }
            
            // Override any potential service worker registration attempts
            const originalAddEventListener = EventTarget.prototype.addEventListener;
            EventTarget.prototype.addEventListener = function(type, listener, options) {
              if (type === 'install' || type === 'activate' || type === 'message') {
                console.log('HTFlow: Service worker event listener blocked:', type);
                return;
              }
              return originalAddEventListener.call(this, type, listener, options);
            };
            
            // Comprehensive error handling
            window.addEventListener('error', function(e) {
              if (e.error && e.error.message) {
                const message = e.error.message.toLowerCase();
                if (message.includes('serviceworker') || 
                    message.includes('service worker') || 
                    message.includes('invalidstateerror') ||
                    message.includes('failed to register')) {
                  console.log('HTFlow: Service worker related error suppressed:', e.error.message);
                  e.stopPropagation();
                  e.preventDefault();
                  return false;
                }
              }
            }, true);
            
            // Block unhandled promise rejections related to service workers
            window.addEventListener('unhandledrejection', function(e) {
              if (e.reason && e.reason.message) {
                const message = e.reason.message.toLowerCase();
                if (message.includes('serviceworker') || 
                    message.includes('service worker') || 
                    message.includes('invalidstateerror')) {
                  console.log('HTFlow: Service worker promise rejection suppressed:', e.reason.message);
                  e.preventDefault();
                  return false;
                }
              }
            });
          })();
        </script>
        <script nonce="${nonce}">`
      );

      return htmlContent;
    } catch (error) {
      console.error("Failed to read htflow-panel.html:", error);
      // Fallback to basic HTML
      return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-inline';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>HTFlow</title>
            </head>
            <body>
                  <div style="padding: 20px; color: white; background: #0c0c0c;">
                      <h1>HTFlow Panel</h1>
                      <p>Failed to load panel. Please check htflow-panel.html exists.</p>
                            </div>
              </body>
              </html>`;
    }
  }

  private setupFileWatcher() {
    // Watch for changes in HTML, CSS, JS, and other web files
    const watchPattern = "**/*.{html,css,js,ts,json,md}";
    this._fileWatcher = vscode.workspace.createFileSystemWatcher(watchPattern);

    // Handle file changes
    this._fileWatcher.onDidChange((uri) => {
      console.log(`HTFlow: File changed: ${uri.fsPath}`);
      this.notifyFileChanged(uri);
    });

    // Handle file creation
    this._fileWatcher.onDidCreate((uri) => {
      console.log(`HTFlow: File created: ${uri.fsPath}`);
      this.notifyFileChanged(uri);
    });

    // Handle file deletion
    this._fileWatcher.onDidDelete((uri) => {
      console.log(`HTFlow: File deleted: ${uri.fsPath}`);
      this.notifyFileChanged(uri);
    });

    console.log("HTFlow: File watcher setup complete");
  }

  private notifyFileChanged(uri: vscode.Uri) {
    // Notify the browser panel about file changes
    if (this._browserPanel) {
      this._browserPanel.webview.postMessage({
        command: "fileChanged",
        filePath: uri.fsPath,
        fileName: path.basename(uri.fsPath),
      });
      console.log(`HTFlow: Sent fileChanged message for ${uri.fsPath}`);
    }

    // Also notify the main view if it exists
    if (this._view) {
      this._view.webview.postMessage({
        command: "fileChanged",
        filePath: uri.fsPath,
        fileName: path.basename(uri.fsPath),
      });
    }
  }

  private async executeHTFlowCommand(command: string, successMessage: string) {
    try {
      console.log(`HTFlow: Executing command: ${command}`);
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      console.log(`HTFlow: Workspace folder:`, workspaceFolder?.uri.fsPath);

      const terminal = vscode.window.createTerminal({
        name: "HTFlow CLI",
        cwd: workspaceFolder?.uri.fsPath,
      });

      console.log(`HTFlow: Terminal created successfully`);

      // Show terminal and execute command
      terminal.show();
      console.log(`HTFlow: Terminal shown`);

      let commandText: string;
      switch (command) {
        case "init":
          commandText = "npx htflow init";
          break;
        case "validate":
          commandText = "npx htflow validate";
          break;
        case "audit":
          commandText = "npx htflow audit";
          break;
        default:
          commandText = `npx htflow ${command}`;
      }

      console.log(`HTFlow: Sending command to terminal: ${commandText}`);
      terminal.sendText(commandText);
      console.log(`HTFlow: Command sent to terminal successfully`);

      vscode.window.showInformationMessage(successMessage);
      console.log(`HTFlow: Success message shown: ${successMessage}`);
    } catch (error) {
      console.error(`HTFlow ${command} error:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to execute HTFlow ${command}: ${errorMessage}`
      );
    }
  }

  private async executeHTFlowCommandWithFolder(
    command: string,
    folder: string | undefined,
    successMessage: string
  ) {
    try {
      console.log(
        `HTFlow: Executing command with folder: ${command}, folder: ${folder}`
      );
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      console.log(`HTFlow: Workspace folder:`, workspaceFolder?.uri.fsPath);

      const terminal = vscode.window.createTerminal({
        name: "HTFlow CLI",
        cwd: workspaceFolder?.uri.fsPath,
      });

      console.log(`HTFlow: Terminal created successfully`);

      // Show terminal and execute command
      terminal.show();
      console.log(`HTFlow: Terminal shown`);

      let commandText: string;
      switch (command) {
        case "audit":
          if (folder && folder.trim() !== "") {
            commandText = `npx htflow audit ${folder.trim()}`;
          } else {
            commandText = "npx htflow audit";
          }
          break;
        default:
          if (folder && folder.trim() !== "") {
            commandText = `npx htflow ${command} ${folder.trim()}`;
          } else {
            commandText = `npx htflow ${command}`;
          }
      }

      console.log(`HTFlow: Sending command to terminal: ${commandText}`);
      terminal.sendText(commandText);
      console.log(`HTFlow: Command sent to terminal successfully`);

      vscode.window.showInformationMessage(successMessage);
      console.log(`HTFlow: Success message shown: ${successMessage}`);
    } catch (error) {
      console.error(`HTFlow ${command} error:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to execute HTFlow ${command}: ${errorMessage}`
      );
    }
  }

  private async executeHTFlowAuditForPanel(
    folder: string | undefined,
    successMessage: string
  ) {
    try {
      console.log(
        `HTFlow: Executing audit for panel display, folder: ${folder}`
      );
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
      }

      // Construct the command
      let commandText: string;
      if (folder && folder.trim() !== "") {
        commandText = `npx htflow audit ${folder.trim()}`;
      } else {
        commandText = "npx htflow audit";
      }

      console.log(`HTFlow: Executing command for panel: ${commandText}`);

      // Create and show terminal for user to see command execution
      const terminal = vscode.window.createTerminal({
        name: `HTFlow: audit`,
        cwd: workspaceFolder.uri.fsPath,
      });

      terminal.show();
      terminal.sendText(commandText);

      // Execute command and capture output for panel results
      const { exec } = require("child_process");
      const util = require("util");
      const execPromise = util.promisify(exec);

      try {
        const { stdout, stderr } = await execPromise(commandText, {
          cwd: workspaceFolder.uri.fsPath,
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large outputs
        });

        const output = stdout || stderr || "No output received";
        console.log(
          `HTFlow: Audit output captured:`,
          output.substring(0, 500) + "..."
        );

        // Send results to panel (both sidebar and right-side panels)
        if (this.webviewView) {
          this.webviewView.webview.postMessage({
            command: "auditResults",
            output: output,
          });
          console.log(`HTFlow: Audit results sent to sidebar panel`);
        }

        // Also send to right-side panel if it exists
        if (this.currentPanel) {
          this.currentPanel.webview.postMessage({
            command: "auditResults",
            output: output,
          });
          console.log(`HTFlow: Audit results sent to right-side panel`);
        }

        vscode.window.showInformationMessage(successMessage);
      } catch (execError: any) {
        console.error(`HTFlow: Audit command failed:`, execError);

        // Even if command fails, try to send the error output to panel
        const errorOutput =
          execError.stdout || execError.stderr || execError.message;
        if (errorOutput) {
          if (this.webviewView) {
            this.webviewView.webview.postMessage({
              command: "auditResults",
              output: errorOutput,
            });
          }
          if (this.currentPanel) {
            this.currentPanel.webview.postMessage({
              command: "auditResults",
              output: errorOutput,
            });
          }
        }

        vscode.window.showErrorMessage(
          `HTFlow audit failed: ${execError.message}`
        );
      }
    } catch (error) {
      console.error(`HTFlow audit panel execution error:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to execute HTFlow audit: ${errorMessage}`
      );
    }
  }

  private async executeHTFlowCommandForPanel(
    command: string,
    successMessage: string,
    folder?: string
  ) {
    try {
      console.log(
        `HTFlow: Executing command for panel display: ${command}, folder: ${folder}`
      );
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];

      if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
      }

      // Construct the full command
      let commandText: string;
      switch (command) {
        case "init":
          commandText = "npx htflow init";
          break;
        case "validate":
          commandText = "npx htflow validate";
          break;
        case "build":
          commandText = "npx htflow build";
          break;
        case "audit --html":
          commandText = "npx htflow audit --html";
          break;
        case "version":
          commandText = "npx htflow --version";
          break;
        case "mcp-install":
          commandText = "npx htflow mcp-install";
          break;
        case "mcp-uninstall":
          commandText = "npx htflow mcp-uninstall";
          break;
        case "mcp-status":
          commandText = "npx htflow mcp-status";
          break;
        default:
          commandText =
            folder && folder.trim()
              ? `npx htflow ${command} ${folder.trim()}`
              : `npx htflow ${command}`;
      }

      console.log(`HTFlow: Executing command: ${commandText}`);

      // Create and show terminal for user to see command execution
      const terminal = vscode.window.createTerminal({
        name: `HTFlow: ${command}`,
        cwd: workspaceFolder.uri.fsPath,
      });

      terminal.show();
      terminal.sendText(commandText);

      // Also execute command and capture output for panel results
      const { exec } = require("child_process");
      const util = require("util");
      const execPromise = util.promisify(exec);

      const startTime = Date.now();

      try {
        const { stdout, stderr } = await execPromise(commandText, {
          cwd: workspaceFolder.uri.fsPath,
          maxBuffer: 1024 * 1024 * 10, // 10MB buffer for large outputs
        });

        const duration = Date.now() - startTime;
        const output =
          stdout || stderr || "Command completed successfully (no output)";
        console.log(
          `HTFlow: Command output captured (${output.length} chars):`,
          output.substring(0, 500) + (output.length > 500 ? "..." : "")
        );

        // Prepare command result data
        const commandData = {
          command: commandText,
          output: output,
          success: true,
          exitCode: 0,
          duration: duration,
        };

        // Send results to panel (both sidebar and right-side panels)
        if (this.webviewView) {
          this.webviewView.webview.postMessage({
            command: "commandResults",
            data: commandData,
          });
          console.log(`HTFlow: Command results sent to sidebar panel`);
        }

        // Also send to right-side panel if it exists
        if (this.currentPanel) {
          this.currentPanel.webview.postMessage({
            command: "commandResults",
            data: commandData,
          });
          console.log(`HTFlow: Command results sent to right-side panel`);
        }

        vscode.window.showInformationMessage(successMessage);
      } catch (execError: any) {
        const duration = Date.now() - startTime;
        console.error(`HTFlow: Command failed:`, execError);

        // Even if command fails, try to send the error output to panel
        const errorOutput =
          execError.stdout ||
          execError.stderr ||
          execError.message ||
          "Command failed with no output";
        console.log(
          `HTFlow: Error output captured (${errorOutput.length} chars):`,
          errorOutput.substring(0, 500) +
            (errorOutput.length > 500 ? "..." : "")
        );

        const commandData = {
          command: commandText,
          output: errorOutput,
          error: true,
          success: false,
          exitCode: execError.code || 1,
          duration: duration,
        };

        if (this.webviewView) {
          this.webviewView.webview.postMessage({
            command: "commandResults",
            data: commandData,
          });
        }
        if (this.currentPanel) {
          this.currentPanel.webview.postMessage({
            command: "commandResults",
            data: commandData,
          });
        }

        vscode.window.showErrorMessage(
          `HTFlow command failed: ${execError.message}`
        );
      }
    } catch (error) {
      console.error(`HTFlow command panel execution error:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to execute HTFlow command: ${errorMessage}`
      );
    }
  }

  private findRunningServerByPort(
    port: number,
    mode?: string
  ): { serverId: string; server: RunningServer } | undefined {
    for (const [serverId, server] of this._runningServers.entries()) {
      if (server.port === port && (!mode || server.mode === mode)) {
        return { serverId, server };
      }
    }
    return undefined;
  }

  private ensureBrowserPortMapping(port: number) {
    if (!this._browserPanel) {
      return;
    }

    const existingOptions = this._browserPanel.webview.options;
    const currentMappings = existingOptions.portMapping ?? [];
    const alreadyMapped = currentMappings.some(
      (mapping) => mapping.extensionHostPort === port
    );

    if (alreadyMapped) {
      return;
    }

    this._browserPanel.webview.options = {
      ...existingOptions,
      portMapping: [
        ...currentMappings,
        { webviewPort: port, extensionHostPort: port },
      ],
    };
  }

  private async startHTFlowServer(
    port: number = 3000,
    mode: string = "dev",
    folder?: string,
    origin: "browser" | "sidebar" = "sidebar",
    hasUserSpecifiedPort: boolean = false
  ): Promise<{ serverId: string; server: RunningServer } | undefined> {
    // Use proper defaults based on mode
    const defaultPort = mode === "dev" ? 3050 : mode === "start" ? 3051 : 3000;
    const normalizedPort = Number.isFinite(port)
      ? Math.max(1, Math.min(65535, Math.floor(port)))
      : defaultPort;

    try {
      const existing = this.findRunningServerByPort(normalizedPort, mode);
      const isBrowserOrigin = origin === "browser";

      if (existing) {
        const { serverId, server } = existing;
        server.terminal.show();

        if (isBrowserOrigin) {
          this._browserLiveServerId = serverId;
          this.ensureBrowserPortMapping(server.port);
          vscode.window.setStatusBarMessage(
            `HTFlow server already running on port ${server.port}`,
            4000
          );
        } else {
          vscode.window.showInformationMessage(
            `HTFlow ${server.mode} server already running on port ${server.port}`
          );
        }

        return existing;
      }

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage(
          "Cannot start HTFlow server: no workspace folder is open"
        );
        return undefined;
      }

      const serverId = `${mode}-${normalizedPort}-${Date.now()}`;
      const terminal = vscode.window.createTerminal({
        name: `HTFlow Server (${mode}:${normalizedPort})`,
        cwd: workspaceFolder.uri.fsPath,
      });

      // Store terminal reference for later cleanup
      this._terminals.set(serverId, terminal);

      const folderValue = folder?.trim() ?? "";
      const serverInfo: RunningServer = {
        port: normalizedPort,
        mode,
        folder: folderValue,
        startTime: new Date(),
        terminal,
        origin,
      };

      this._runningServers.set(serverId, serverInfo);
      if (isBrowserOrigin) {
        this._browserLiveServerId = serverId;
      }

      terminal.show();
      const folderArg = folderValue ? ` ${folderValue}` : "";

      // Use different commands based on mode and port specification
      let command;
      if (mode === "dev" && !hasUserSpecifiedPort) {
        // For dev mode without user port, use htflow dev (lets CLI choose default)
        command = `npx htflow dev${folderArg}`;
      } else if (mode === "start" && !hasUserSpecifiedPort) {
        // For prod mode without user port, use htflow serve (lets CLI choose default)
        command = `npx htflow serve${folderArg}`;
      } else {
        // When user specifies port, use htflow serve with -p flag
        const portArg = ` -p ${normalizedPort}`;
        command = `npx htflow serve ${mode}${folderArg}${portArg}`;
      }

      console.log(`HTFlow: Executing command: ${command}`);
      terminal.sendText(command);

      const folderText = folderValue ? ` from folder '${folderValue}'` : "";
      const statusMessage = `HTFlow ${mode} server starting on port ${normalizedPort}${folderText}...`;

      if (isBrowserOrigin) {
        vscode.window.setStatusBarMessage(statusMessage, 4000);
      } else {
        vscode.window.showInformationMessage(statusMessage);
      }

      const payload = {
        port: serverInfo.port,
        mode: serverInfo.mode,
        folder: serverInfo.folder,
        startTime: serverInfo.startTime.toISOString(),
      };

      if (this._view) {
        console.log(`HTFlow: Sending serverStarted message to sidebar view:`, {
          command: "serverStarted",
          serverId,
          serverInfo: payload,
        });
        this._view.webview.postMessage({
          command: "serverStarted",
          serverId,
          serverInfo: payload,
        });
      }

      if (this._browserPanel) {
        this._browserPanel.webview.postMessage({
          command: "serverStarted",
          serverId,
          serverInfo: payload,
        });
      }

      if (!isBrowserOrigin) {
        setTimeout(() => {
          vscode.commands.executeCommand(
            "vscode.open",
            vscode.Uri.parse(`http://localhost:${normalizedPort}`)
          );
        }, 3000);
      } else {
        this.ensureBrowserPortMapping(normalizedPort);
      }

      console.log(`HTFlow: Server started with ID ${serverId}`);
      return { serverId, server: serverInfo };
    } catch (error) {
      console.error("HTFlow server error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to start HTFlow server: ${errorMessage}`
      );
      return undefined;
    }
  }

  private async handleToolAction(tool: string) {
    try {
      switch (tool) {
        case "react-to-htflow":
          vscode.window.showInformationMessage(
            "React to HTFlow converter - Feature coming soon!"
          );
          break;
        case "tailwind-to-css":
          vscode.window.showInformationMessage(
            "Tailwind to CSS converter - Feature coming soon!"
          );
          break;
        case "css-optimizer":
          vscode.window.showInformationMessage(
            "CSS optimizer - Feature coming soon!"
          );
          break;
        default:
          vscode.window.showInformationMessage(`Tool action: ${tool}`);
      }
    } catch (error) {
      console.error(`Tool action error for ${tool}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to execute tool ${tool}: ${errorMessage}`
      );
    }
  }

  private async handleSettingChange(setting: string, value: boolean) {
    try {
      const config = vscode.workspace.getConfiguration("htflow");
      await config.update(setting, value, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `HTFlow: ${setting} ${value ? "enabled" : "disabled"}`
      );
    } catch (error) {
      console.error(`Setting change error for ${setting}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to update setting ${setting}: ${errorMessage}`
      );
    }
  }

  private async validateSpecificFile(filePath: string) {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        const fullPath = path.join(workspaceFolder.uri.fsPath, filePath);
        const terminal = vscode.window.createTerminal({
          name: "HTFlow Validate",
          cwd: workspaceFolder.uri.fsPath,
        });

        terminal.show();
        terminal.sendText(`npx htflow validate "${filePath}"`);
        vscode.window.showInformationMessage(`Validating file: ${filePath}`);
      }
    } catch (error) {
      console.error(`File validation error for ${filePath}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to validate file ${filePath}: ${errorMessage}`
      );
    }
  }

  private async checkHTFlowVersion() {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        const terminal = vscode.window.createTerminal({
          name: "HTFlow Version",
          cwd: workspaceFolder.uri.fsPath,
        });

        terminal.show();
        terminal.sendText("npx htflow --version");
        vscode.window.showInformationMessage("Checking HTFlow version...");
      }
    } catch (error) {
      console.error("Failed to check HTFlow version:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to check version: ${errorMessage}`
      );
    }
  }

  private async executeNpmCommand(command: string, successMessage: string) {
    try {
      console.log(`HTFlow: Executing NPM command: ${command}`);

      const terminal = vscode.window.createTerminal({
        name: "NPM HTFlow",
      });

      console.log(`HTFlow: NPM terminal created successfully`);

      terminal.show();
      console.log(`HTFlow: NPM terminal shown`);

      const commandText = `npm ${command}`;
      console.log(`HTFlow: Sending NPM command to terminal: ${commandText}`);
      terminal.sendText(commandText);
      console.log(`HTFlow: NPM command sent to terminal successfully`);

      vscode.window.showInformationMessage(
        successMessage.replace("successfully!", "...")
      );

      // Show completion message after a delay
      setTimeout(() => {
        vscode.window.showInformationMessage(successMessage);
      }, 3000);
    } catch (error) {
      console.error(`Failed to execute npm command: ${command}`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to execute npm command: ${errorMessage}`
      );
    }
  }

  public _getBrowserHtmlForWebview(webview: vscode.Webview) {
    const nonce = getNonce();

    // Read the browser HTML file
    const htmlPath = path.join(
      this._extensionUri.fsPath,
      "htflow-browser-panel.html"
    );

    try {
      let htmlContent = fs.readFileSync(htmlPath, "utf8");

      // Update Content Security Policy for VS Code
      // - Allow ${webview.cspSource} for frame-src so we can iframe webview URIs
      // - Allow https: in style-src so @import for Google Fonts doesn't get blocked
      htmlContent = htmlContent.replace(
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />',
        `<meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https:; script-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-inline'; font-src https:; connect-src https: http: ws:; img-src ${webview.cspSource} https: data:; frame-src ${webview.cspSource} https: http: data:;">`
      );

      // Add nonce to script tags
      htmlContent = htmlContent.replace(
        "<script>",
        `<script nonce="${nonce}">`
      );

      return htmlContent;
    } catch (error) {
      console.error("Failed to read htflow-browser-panel.html:", error);
      // Fallback to basic HTML
      return `<!DOCTYPE html>
              <html lang="en">
              <head>
                  <meta charset="UTF-8">
                  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'unsafe-inline';">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <title>HTFlow Browser</title>
              </head>
              <body>
                  <div style="padding: 20px; color: white; background: #0c0c0c;">
                      <h1>HTFlow Browser Panel</h1>
                      <p>Failed to load browser panel. Please check htflow-browser-panel.html exists.</p>
                </div>
            </body>
            </html>`;
    }
  }

  private async openIndexInBrowser() {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        const indexPath = path.join(workspaceFolder.uri.fsPath, "index.html");
        if (fs.existsSync(indexPath)) {
          // Send message to browser panel if open
          if (this._browserPanel) {
            const asWebviewUri = this._browserPanel.webview.asWebviewUri(
              vscode.Uri.file(indexPath)
            );
            this._browserPanel.webview.postMessage({
              command: "openUrl",
              url: asWebviewUri.toString(),
            });
          }
          // Also open in VS Code
          await vscode.commands.executeCommand(
            "vscode.open",
            vscode.Uri.file(indexPath)
          );
        } else {
          vscode.window.showWarningMessage(
            "index.html not found in workspace root"
          );
        }
      }
    } catch (error) {
      console.error("Open index error:", error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to open index.html: ${errorMessage}`
      );
    }
  }

  private async stopServer(serverId: string, port?: number): Promise<boolean> {
    try {
      const serverInfo = this._runningServers.get(serverId);
      const resolvedPort = port ?? serverInfo?.port;
      const isBrowserOrigin = serverInfo?.origin === "browser";

      if (!serverInfo && !this._terminals.has(serverId)) {
        console.warn(`HTFlow: No running server found for ID ${serverId}`);
        return false;
      }

      console.log(
        `HTFlow: Stopping server ${serverId}` +
          (resolvedPort ? ` on port ${resolvedPort}` : "")
      );

      const terminal =
        this._terminals.get(serverId) ?? serverInfo?.terminal ?? null;
      if (terminal) {
        try {
          terminal.sendText("\u0003", false);
        } catch (e) {
          console.log(
            `HTFlow: Unable to send interrupt to server ${serverId}:`,
            e
          );
        }
        terminal.dispose();
        this._terminals.delete(serverId);
        console.log(`HTFlow: Terminal disposed for server ${serverId}`);
      }

      this._runningServers.delete(serverId);

      if (this._view) {
        this._view.webview.postMessage({
          command: "serverStopped",
          serverId,
          port: resolvedPort,
        });
      }

      if (this._browserPanel) {
        this._browserPanel.webview.postMessage({
          command: "serverStopped",
          serverId,
          port: resolvedPort,
        });
      }

      if (this._browserLiveServerId === serverId) {
        this._browserLiveServerId = undefined;
        if (this._browserPanel) {
          this._browserPanel.webview.postMessage({
            command: "liveServerStopped",
          });
        }
      }

      const successMessage = resolvedPort
        ? `HTFlow server on port ${resolvedPort} stopped successfully`
        : `HTFlow server stopped successfully`;

      if (isBrowserOrigin) {
        vscode.window.setStatusBarMessage(successMessage, 3000);
      } else {
        vscode.window.showInformationMessage(successMessage);
      }

      console.log(`HTFlow: Server ${serverId} stopped successfully`);
      return true;
    } catch (error) {
      console.error(`HTFlow: Error stopping server ${serverId}:`, error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(
        `Failed to stop HTFlow server: ${errorMessage}`
      );
      return false;
    }
  }

  public dispose() {
    // Clean up file watcher
    if (this._fileWatcher) {
      this._fileWatcher.dispose();
      this._fileWatcher = undefined;
      console.log("HTFlow: File watcher disposed");
    }

    // Clean up browser panel
    if (this._browserPanel) {
      this._browserPanel.dispose();
      this._browserPanel = undefined;
    }

    // Clean up all running terminals
    this._terminals.forEach((terminal, serverId) => {
      terminal.dispose();
      console.log(`HTFlow: Terminal disposed for server ${serverId}`);
    });
    this._terminals.clear();
    this._runningServers.clear();
  }
}

function getNonce() {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
