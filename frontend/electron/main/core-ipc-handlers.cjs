function registerCoreIpcHandlers(ipcMain, options) {
    const {
        app,
        checkDaemonRunning,
        checkMcpHealth,
        checkSetupPrereqs,
        codingAgentsDiscover,
        copyFsPath,
        createFsDirectory,
        deleteDataPath,
        deleteFsPath,
        discordSendMessage,
        ensureZoraiDataDir,
        getAvailableShells,
        getDaemonPath,
        getFsPathInfo,
        getPlatform,
        getSocketPath,
        getSystemFonts,
        getSystemMonitorSnapshot,
        gitDiff,
        gitStatus,
        listDataDir,
        listFsDir,
        loadInstalledPlugins,
        moveFsPath,
        openDataPath,
        openExternalPath,
        openExternalRelativePath,
        pluginHandlers,
        readFsText,
        readJsonFile,
        readTextFile,
        revealDataPath,
        revealFsPath,
        saveVisionScreenshot,
        setWindowOpacity,
        spawnDaemon,
        terminalBridgeRuntime,
        writeFsText,
        writeJsonFile,
        writeTextFile,
        windowState,
        workspaceService,
        startWorkspaceWatch,
        stopWorkspaceWatch,
    } = options;

    ipcMain.handle('getSocketPath', getSocketPath);
    ipcMain.handle('checkDaemon', () => checkDaemonRunning());
    ipcMain.handle('spawnDaemon', () => spawnDaemon());
    ipcMain.handle('getSystemFonts', () => getSystemFonts());
    ipcMain.handle('getAvailableShells', () => getAvailableShells());
    ipcMain.handle('system-monitor-snapshot', (_event, runtimeOptions) => getSystemMonitorSnapshot(runtimeOptions));
    ipcMain.handle('getDaemonPath', () => getDaemonPath());
    ipcMain.handle('getPlatform', () => getPlatform());
    ipcMain.handle('setup-check-prereqs', (event, profile) => checkSetupPrereqs(event, profile));
    ipcMain.handle('coding-agents-discover', codingAgentsDiscover);
    ipcMain.handle('ai-training-discover', (_event, workspacePath) => options.aiTrainingDiscover(workspacePath));
    ipcMain.handle('plugin-list-installed', () => pluginHandlers.listInstalled());
    ipcMain.handle('plugin-load-installed', () => loadInstalledPlugins());
    ipcMain.handle('plugin-daemon-list', pluginHandlers.listDaemon);
    ipcMain.handle('plugin-daemon-get', pluginHandlers.getDaemon);
    ipcMain.handle('plugin-daemon-enable', pluginHandlers.enableDaemon);
    ipcMain.handle('plugin-daemon-disable', pluginHandlers.disableDaemon);
    ipcMain.handle('plugin-daemon-install', pluginHandlers.installDaemon);
    ipcMain.handle('plugin-daemon-uninstall', pluginHandlers.uninstallDaemon);
    ipcMain.handle('plugin-get-settings', pluginHandlers.getSettings);
    ipcMain.handle('plugin-update-settings', pluginHandlers.updateSettings);
    ipcMain.handle('plugin-test-connection', pluginHandlers.testConnection);
    ipcMain.handle('plugin-oauth-start', pluginHandlers.startOAuth);
    ipcMain.handle('diagnostics-check-lsp', options.checkLspHealth);
    ipcMain.handle('diagnostics-check-mcp', checkMcpHealth);
    ipcMain.handle('persistence-get-data-dir', () => ensureZoraiDataDir());
    ipcMain.handle('persistence-read-json', (_event, relativePath) => readJsonFile(relativePath));
    ipcMain.handle('persistence-write-json', (_event, relativePath, data) => writeJsonFile(relativePath, data));
    ipcMain.handle('persistence-read-text', (_event, relativePath) => readTextFile(relativePath));
    ipcMain.handle('persistence-write-text', (_event, relativePath, content) => writeTextFile(relativePath, content));
    ipcMain.handle('persistence-delete-path', (_event, relativePath) => deleteDataPath(relativePath));
    ipcMain.handle('persistence-list-dir', (_event, relativeDir) => listDataDir(relativeDir));
    ipcMain.handle('persistence-open-path', (_event, relativePath) => openExternalRelativePath(relativePath));
    ipcMain.handle('persistence-reveal-path', (_event, relativePath) => revealDataPath(relativePath));
    ipcMain.handle('fs-list-dir', (_event, targetDir) => listFsDir(targetDir));
    ipcMain.handle('fs-copy-path', (_event, sourcePath, destinationPath) => copyFsPath(sourcePath, destinationPath));
    ipcMain.handle('fs-move-path', (_event, sourcePath, destinationPath) => moveFsPath(sourcePath, destinationPath));
    ipcMain.handle('fs-delete-path', (_event, targetPath) => deleteFsPath(targetPath));
    ipcMain.handle('fs-mkdir', (_event, targetDirPath) => createFsDirectory(targetDirPath));
    ipcMain.handle('fs-open-path', (_event, targetPath) => openExternalPath(targetPath));
    ipcMain.handle('fs-reveal-path', (_event, targetPath) => revealFsPath(targetPath));
    ipcMain.handle('fs-read-text', (_event, targetPath) => readFsText(targetPath));
    ipcMain.handle('fs-write-text', (_event, targetPath, content) => writeFsText(targetPath, content));
    ipcMain.handle('fs-path-info', (_event, targetPath) => getFsPathInfo(targetPath));
    ipcMain.handle('git-status', (_event, targetPath) => gitStatus(targetPath));
    ipcMain.handle('git-diff', (_event, targetPath, filePath) => gitDiff(targetPath, filePath));
    ipcMain.handle('workspace-open', (_event, rootPath) => workspaceService.openWorkspace(rootPath));
    ipcMain.handle('workspace-list-directory', (_event, rootPath, relativePath, runtimeOptions) => workspaceService.listWorkspaceDirectory(rootPath, relativePath, runtimeOptions));
    ipcMain.handle('workspace-read-file', (_event, rootPath, relativePath, runtimeOptions) => workspaceService.readWorkspaceFile(rootPath, relativePath, runtimeOptions));
    ipcMain.handle('workspace-write-file', (_event, rootPath, relativePath, content, expectedHash) => workspaceService.writeWorkspaceFile(rootPath, relativePath, content, expectedHash));
    ipcMain.handle('workspace-create-directory', (_event, rootPath, relativePath) => workspaceService.createWorkspaceDirectory(rootPath, relativePath));
    ipcMain.handle('workspace-rename-path', (_event, rootPath, fromPath, toPath) => workspaceService.renameWorkspacePath(rootPath, fromPath, toPath));
    ipcMain.handle('workspace-delete-path', (_event, rootPath, relativePath, runtimeOptions) => workspaceService.deleteWorkspacePath(rootPath, relativePath, runtimeOptions));
    ipcMain.handle('workspace-git-status', (_event, rootPath) => workspaceService.workspaceGitStatus(rootPath));
    ipcMain.handle('workspace-git-overview', (_event, rootPath) => workspaceService.workspaceGitOverview(rootPath));
    ipcMain.handle('workspace-git-commit', (_event, rootPath, message) => workspaceService.workspaceGitCommit(rootPath, message));
    ipcMain.handle('workspace-git-list-worktrees', (_event, rootPath) => workspaceService.workspaceGitListWorktrees(rootPath));
    ipcMain.handle('workspace-git-create-worktree', (_event, rootPath, runtimeOptions) => workspaceService.workspaceGitCreateWorktree(rootPath, runtimeOptions));
    ipcMain.handle('workspace-git-remove-worktree', (_event, rootPath, worktreePath) => workspaceService.workspaceGitRemoveWorktree(rootPath, worktreePath));
    ipcMain.handle('workspace-git-stage', (_event, rootPath, relativePath) => workspaceService.workspaceGitStage(rootPath, relativePath));
    ipcMain.handle('workspace-git-unstage', (_event, rootPath, relativePath) => workspaceService.workspaceGitUnstage(rootPath, relativePath));
    ipcMain.handle('workspace-git-discard', (_event, rootPath, relativePath) => workspaceService.workspaceGitDiscard(rootPath, relativePath));
    ipcMain.handle('workspace-git-hunks', (_event, rootPath, relativePath, runtimeOptions) => workspaceService.workspaceGitHunks(rootPath, relativePath, runtimeOptions));
    ipcMain.handle('workspace-git-apply-hunk', (_event, rootPath, relativePath, hunkId, action) => workspaceService.workspaceGitApplyHunk(rootPath, relativePath, hunkId, action));
    ipcMain.handle('workspace-search', (_event, rootPath, query, runtimeOptions) => workspaceService.searchWorkspace(rootPath, query, runtimeOptions));
    ipcMain.handle('workspace-git-diff', (_event, rootPath, relativePath, runtimeOptions) => workspaceService.workspaceGitDiff(rootPath, relativePath, runtimeOptions));
    ipcMain.handle('workspace-watch-start', (event, rootPath, runtimeOptions) => startWorkspaceWatch(event.sender, rootPath, runtimeOptions));
    ipcMain.handle('workspace-watch-stop', (_event, subscriptionId) => stopWorkspaceWatch(subscriptionId));
    ipcMain.handle('clipboard-read-text', () => options.clipboard.readText());
    ipcMain.handle('clipboard-write-text', (_event, text) => { options.clipboard.writeText(typeof text === 'string' ? text : ''); return true; });
    ipcMain.handle('terminal-start', terminalBridgeRuntime.startTerminalBridge);
    ipcMain.handle('terminal-input', terminalBridgeRuntime.sendTerminalInput);
    ipcMain.handle('terminal-execute-managed', terminalBridgeRuntime.executeManagedCommand);
    ipcMain.handle('terminal-approval-decision', terminalBridgeRuntime.resolveManagedApproval);
    ipcMain.handle('terminal-search-history', terminalBridgeRuntime.searchManagedHistory);
    ipcMain.handle('terminal-generate-skill', terminalBridgeRuntime.generateManagedSkill);
    ipcMain.handle('terminal-find-symbol', terminalBridgeRuntime.findManagedSymbol);
    ipcMain.handle('terminal-list-snapshots', terminalBridgeRuntime.listSnapshots);
    ipcMain.handle('terminal-restore-snapshot', terminalBridgeRuntime.restoreSnapshot);
    ipcMain.handle('terminal-clone-session', terminalBridgeRuntime.cloneTerminalSession);
    ipcMain.handle('terminal-resize', terminalBridgeRuntime.resizeTerminalSession);
    ipcMain.handle('terminal-stop', (_event, paneId, killSession) => terminalBridgeRuntime.stopTerminalBridge(paneId, Boolean(killSession)));
    ipcMain.handle('window-minimize', () => windowState()?.minimize());
    ipcMain.handle('window-maximize', () => {
        if (windowState()?.isMaximized()) windowState().unmaximize();
        else windowState()?.maximize();
    });
    ipcMain.handle('window-close', () => { terminalBridgeRuntime.stopAllTerminalBridges(true, true); app.quit(); return true; });
    ipcMain.handle('window-isMaximized', () => windowState()?.isMaximized() ?? false);
    ipcMain.handle('window-set-opacity', (_event, opacity) => setWindowOpacity(opacity));
    ipcMain.handle('vision-save-screenshot', (_event, payload) => saveVisionScreenshot(payload));
    ipcMain.handle('discord-send-message', (_event, payload) => discordSendMessage(payload));
}

module.exports = { registerCoreIpcHandlers };
