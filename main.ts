import { Plugin, addIcon, Notice, WorkspaceLeaf } from 'obsidian';
import { OZSyncSettings, DEFAULT_SETTINGS, SyncOperation, SyncLog, SyncStatus } from './src/types';
import { OZSyncClient } from './src/ozsync-client';
import { SyncManager } from './src/sync-manager';
import { OZSyncSettingsTab } from './src/components/settings-view';
import { StatusView, STATUS_VIEW_TYPE } from './src/components/status-view';
import { CloudBrowserView, CLOUD_BROWSER_VIEW_TYPE } from './src/components/cloud-browser';

export default class OZSyncPlugin extends Plugin {
	settings: OZSyncSettings;
	ozsyncClient: OZSyncClient;
	syncManager: SyncManager;
	syncStatus: SyncStatus;
	recentOperations: SyncOperation[] = [];
	errorLogs: SyncLog[] = [];
	private autoSyncInterval: number | null = null;
	private tokenRefreshInterval: number | null = null;
	private statusBarItem: HTMLElement | null = null;

	async onload() {
		await this.loadSettings();

		// Initialize clients
		this.ozsyncClient = new OZSyncClient(this.settings);
		this.syncManager = new SyncManager(
			this.ozsyncClient, 
			this.settings, 
			this.addLog.bind(this),
			// 状态更新回调 - 同步sync-manager的状态到main.ts
			(updates: Partial<SyncStatus>) => {
				this.updateSyncStatus(updates);
			}
		);

		// Initialize sync status
		console.log('[Main] Initializing sync status...');
		this.syncStatus = {
			isConnected: false,
			syncInProgress: false,
			status: 'idle',
			lastSyncTime: undefined,
			pendingFiles: 0,
			processedFiles: 0,
			totalFiles: 0,
			syncSpeed: 0,
			bytesTransferred: 0,
			totalBytes: 0,
			errorCount: 0,
			lastError: undefined,
			startTime: undefined
		};
		console.log('[Main] Initial sync status:', {
			syncStatus: this.syncStatus,
			timestamp: new Date().toISOString()
		});

		// Register views
		this.registerView(
			STATUS_VIEW_TYPE,
			(leaf) => new StatusView(leaf, this)
		);

		this.registerView(
			CLOUD_BROWSER_VIEW_TYPE,
			(leaf) => new CloudBrowserView(leaf, this)
		);

		// Add ribbon icons
		this.addRibbonIcon('cloud-sync', 'OZSync Status', () => {
			this.activateView(STATUS_VIEW_TYPE);
		});

		this.addRibbonIcon('cloud', 'OZSync', () => {
			this.ozsyncClient.login(this.settings.username, this.settings.password);
		});

		// Create status bar item
		console.log('[Main] Creating status bar item...');
		this.statusBarItem = this.addStatusBarItem();
		console.log('[Main] Status bar item created:', {
			hasStatusBarItem: !!this.statusBarItem,
			statusBarElement: this.statusBarItem,
			timestamp: new Date().toISOString()
		});
		
		console.log('[Main] Initial status bar update...');
		this.updateStatusBar();
		
		// Update status bar every second for countdown
		console.log('[Main] Setting up status bar update interval...');
		this.registerInterval(window.setInterval(() => {
			this.updateStatusBar();
		}, 1000));
		console.log('[Main] Status bar update interval registered');

		// Add commands
		this.addCommand({
			id: 'ozsync-now',
			name: 'Sync Now',
			callback: () => this.performManualSync()
		});

		// 添加调试命令
		this.addCommand({
			id: 'debug-status-bar',
			name: 'Debug Status Bar',
			callback: () => this.debugStatusBar()
		});

		// 将插件实例暴露到全局，方便调试
		(window as any).ozsyncPlugin = this;
		console.log('[OZSync Plugin] 插件实例已暴露到 window.ozsyncPlugin，可在控制台中调试');



		this.addCommand({
			id: 'ozsync-login',
			name: 'Login to OZSync',
			callback: async () => {
				try {
					const success = await this.ozsyncClient.login(this.settings.username, this.settings.password);
				console.log('[Main] Login result:', { success, timestamp: new Date().toISOString() });
				
				if (success) {
					console.log('[Main] Login successful, updating connection status...');
					// 登录成功后立即设置连接状态为true
					this.updateSyncStatus({ isConnected: true });
					// 然后测试连接以确保状态正确
					await this.updateConnectionStatus();
					new Notice('Login successful!');
				} else {
					console.log('[Main] Login failed, setting connection status to false');
					// 登录失败时确保连接状态为false
					this.updateSyncStatus({ isConnected: false });
					new Notice('Login failed!');
				}
				} catch (error) {
					// 登录错误时确保连接状态为false
					this.updateSyncStatus({ isConnected: false });
					new Notice('Login error: ' + error.message);
				}
			}
		});

		this.addCommand({
			id: 'ozsync-open-status',
			name: 'Open Sync Status',
			callback: () => this.activateView(STATUS_VIEW_TYPE)
		});

		this.addCommand({
			id: 'ozsync-open-browser',
			name: 'Open Cloud Browser',
			callback: () => this.activateView(CLOUD_BROWSER_VIEW_TYPE)
		});



		// Add settings tab
		this.addSettingTab(new OZSyncSettingsTab(this.app, this));

		// Initialize connection and sync
		await this.initializePlugin();
	}

	async onunload() {
		// Stop auto sync
		if (this.autoSyncInterval) {
			clearInterval(this.autoSyncInterval);
			this.autoSyncInterval = null;
		}

		// Stop proactive token refresh
		if (this.tokenRefreshInterval) {
			clearInterval(this.tokenRefreshInterval);
			this.tokenRefreshInterval = null;
		}

		// Cleanup sync manager
		if (this.syncManager) {
			this.syncManager.stopAutoSync();
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		
		// Update clients with new settings
		if (this.ozsyncClient) {
			this.ozsyncClient.updateSettings(this.settings);
		}
		if (this.syncManager) {
			this.syncManager.updateSettings(this.settings);
		}

		// Restart auto sync if settings changed
		this.setupAutoSync();
	}

	private async initializePlugin(): Promise<void> {
		try {
			console.log('[Main] Starting plugin initialization...');
			console.log('[Main] Current sync status before initialization:', this.syncStatus);
			
			// Always initialize sync manager
			console.log('[Main] Initializing sync manager...');
			await this.syncManager.initialize();
			console.log('[Main] Sync manager initialized successfully');
			
			// Setup auto sync if enabled
			console.log('[Main] Setting up auto sync...');
			this.setupAutoSync();
			console.log('[Main] Auto sync setup completed');
			
			// Update connection status after initialization
			console.log('[Main] Updating connection status after initialization...');
			await this.updateConnectionStatus();
			console.log('[Main] Connection status updated after initialization');
			
			console.log('[Main] ZimaOS plugin initialized successfully');
			console.log('[Main] Final sync status after initialization:', this.syncStatus);
		} catch (error) {
			console.error('[Main] Failed to initialize ZimaOS sync plugin:', error);
			this.logError('Plugin initialization failed', error);
		}
	}

	private setupAutoSync(): void {
		// Clear existing interval
		if (this.autoSyncInterval) {
			clearInterval(this.autoSyncInterval);
			this.autoSyncInterval = null;
			console.log('Auto sync timer cleared');
		}

		// Clear existing token refresh interval
		if (this.tokenRefreshInterval) {
			clearInterval(this.tokenRefreshInterval);
			this.tokenRefreshInterval = null;
		}

		// Setup new interval if auto sync is enabled
		if (this.settings.autoSyncEnabled && this.settings.syncInterval > 0) {
			const intervalMs = this.settings.syncInterval * 60 * 1000; // Convert minutes to milliseconds
			this.autoSyncInterval = window.setInterval(() => {
				console.log('Auto sync timer triggered - starting automatic sync');
				this.performAutoSync();
			}, intervalMs);
			console.log(`Auto sync enabled: interval set to ${this.settings.syncInterval} minutes (${intervalMs}ms)`);

			// Proactive token refresh: check every 5 minutes, refresh if expiring within 10 minutes
			this.tokenRefreshInterval = window.setInterval(async () => {
				try {
					const authState = this.ozsyncClient?.getAuthState?.();
					if (!authState?.isAuthenticated || !authState?.tokenData?.expires_at) {
						return;
					}
					const now = Date.now() / 1000;
					const expiresAt = authState.tokenData.expires_at;
					const minutesUntilExpiry = (expiresAt - now) / 60;

					if (minutesUntilExpiry <= 10) {
						console.log(`[OZSync Token] Token expiring in ${Math.round(minutesUntilExpiry)}min, refreshing proactively`);
						await this.ozsyncClient.ensureValidToken();
					}
				} catch (error) {
					console.error('[OZSync Token] Proactive refresh failed:', error);
				}
			}, 5 * 60 * 1000); // Check every 5 minutes
			console.log('Proactive token refresh enabled (every 5 min, threshold: 10 min)');
		} else {
			console.log('Auto sync disabled or invalid interval');
		}
	}

	private async performAutoSync(): Promise<void> {
		console.log('Auto sync: Starting automatic synchronization...');

		if (this.syncStatus.syncInProgress) {
			console.log('Auto sync: Skipping - sync already in progress');
			return;
		}

		this.updateSyncStatus({ syncInProgress: true });
		try {
			console.log('Auto sync: Executing sync operation');
			await this.syncManager.performSync();
			this.updateSyncStatus({ syncInProgress: false, lastSyncTime: new Date(), errorCount: 0 });
			console.log('Auto sync: Completed successfully');
		} catch (error) {
			console.error('Auto sync failed:', error);
			this.logError('Auto sync failed', error);
			this.updateSyncStatus({ syncInProgress: false, errorCount: this.syncStatus.errorCount + 1 });
		} finally {
			this.updateSyncStatus({ syncInProgress: false });
		}
	}

	async performManualSync(): Promise<void> {
		if (this.syncStatus.syncInProgress) {
			new Notice('Sync already in progress');
			return;
		}

		this.updateSyncStatus({ syncInProgress: true });
		try {
			new Notice('Starting sync...');

			await this.syncManager.performSync();

			this.updateSyncStatus({
				syncInProgress: false,
				lastSyncTime: new Date(),
				errorCount: 0,
				lastError: undefined
			});
			new Notice('Sync completed successfully');
		} catch (error) {
			console.error('Manual sync failed:', error);
			this.logError('Manual sync failed', error);
			this.updateSyncStatus({
				syncInProgress: false,
				errorCount: this.syncStatus.errorCount + 1,
				lastError: error.message
			});
			new Notice('Sync failed: ' + error.message);
		} finally {
			this.updateSyncStatus({ syncInProgress: false });
		}
	}





	// Public methods for components
	getSyncStatus(): SyncStatus {
		return { ...this.syncStatus };
	}

	getRecentOperations(limit: number = 10): SyncOperation[] {
		return this.recentOperations.slice(0, limit);
	}

	getErrorLogs(limit: number = 20): SyncLog[] {
		return this.errorLogs.slice(0, limit);
	}

	clearLogs(): void {
		this.errorLogs = [];
		this.recentOperations = [];
	}



	updateSyncSettings(): void {
		this.syncManager.updateSettings(this.settings);
	}

	addLog(log: any): void {
		console.log('ZimaOS Sync Log:', log);
	}

	// 调试方法
	debugStatusBar(): void {
		console.log('=== ZimaOS 状态栏调试信息 ===');
		console.log('当前时间:', new Date().toISOString());
		console.log('插件实例:', this);
		console.log('同步状态:', this.syncStatus);
		console.log('状态栏元素:', this.statusBarItem);
		
		if (this.statusBarItem) {
			console.log('状态栏元素详情:', {
				element: this.statusBarItem,
				text: this.statusBarItem.getText(),
				innerHTML: this.statusBarItem.innerHTML,
				isVisible: this.statusBarItem.style.display !== 'none',
				className: this.statusBarItem.className
			});
		} else {
			console.error('Status bar element not found!');
		}
		
		if (this.ozsyncClient) {
			console.log('OZSync client auth state:', this.ozsyncClient.getAuthState());
		} else {
			console.error('OZSync client not found!');
		}
		
		console.log('Manually triggering status bar update...');
		this.updateStatusBar();
		
		console.log('Manually triggering connection test...');
		if (this.ozsyncClient) {
			this.ozsyncClient.testConnection().then((result: any) => {
				console.log('Connection test result:', result);
			}).catch((error: any) => {
				console.error('Connection test failed:', error);
			});
		}
		
		console.log('=== Debug info end ===');
	}

	// Private helper methods
	private updateSyncStatus(updates: Partial<SyncStatus>): void {
		console.log('[Main] Updating sync status:', {
			updates,
			currentStatus: this.syncStatus,
			timestamp: new Date().toISOString()
		});
		
		this.syncStatus = { ...this.syncStatus, ...updates };
		
		console.log('[Main] Sync status updated:', {
			newStatus: this.syncStatus,
			isConnected: this.syncStatus.isConnected,
			timestamp: new Date().toISOString()
		});
		
		this.updateStatusBar();
		console.log('[Main] Status bar updated after sync status change');
	}

	/**
	 * Update connection status
	 */
	private async updateConnectionStatus(): Promise<void> {
		try {
			console.log('[Main] Starting connection status update...');
			// Test connection status
			const isConnected = await this.syncManager.testConnection();
			console.log('[Main] testConnection result:', { isConnected });
			
			// Note: testConnection has already updated status via notifyStatusUpdate
			// Here we ensure main.ts status is consistent with sync-manager
			const syncStatus = this.syncManager.getSyncStatus();
			console.log('[Main] SyncManager status:', {
				isConnected: syncStatus.isConnected,
				nextSyncTime: syncStatus.nextSyncTime,
				status: syncStatus.status
			});
			
			this.updateSyncStatus({ 
				isConnected: syncStatus.isConnected,
				nextSyncTime: syncStatus.nextSyncTime 
			});
			console.log('[Main] Connection status update completed:', syncStatus.isConnected);
		} catch (error) {
			console.error('[Main] Failed to update connection status:', error);
			this.updateSyncStatus({ isConnected: false });
		}
	}

	private updateStatusBar(): void {
		console.log('[StatusBar] updateStatusBar called:', {
			timestamp: new Date().toISOString(),
			hasStatusBarItem: !!this.statusBarItem,
			syncStatus: {
				isConnected: this.syncStatus.isConnected,
				syncInProgress: this.syncStatus.syncInProgress,
				nextSyncTime: this.syncStatus.nextSyncTime,
				errorCount: this.syncStatus.errorCount,
				autoSyncEnabled: this.settings.autoSyncEnabled
			}
		});

		if (!this.statusBarItem) {
			console.warn('[StatusBar] No status bar item found!');
			return;
		}

		let statusText = 'OZSync: ';
		let statusReason = '';
		
		// Display backup status
		if (this.syncStatus.syncInProgress) {
			statusText += '🔄 Syncing';
			statusReason = 'sync in progress';
		} else if (!this.syncStatus.isConnected) {
			statusText += '🔴 Disconnected';
			statusReason = 'not connected';
		} else if (this.settings.autoSyncEnabled && this.syncStatus.nextSyncTime) {
			// Waiting for sync status - show next sync time and countdown
			const now = new Date().getTime();
			const nextSync = new Date(this.syncStatus.nextSyncTime).getTime();
			const timeDiff = Math.max(0, nextSync - now);
			
			if (timeDiff > 0) {
				const nextSyncTime = new Date(this.syncStatus.nextSyncTime);
				const timeStr = nextSyncTime.toLocaleTimeString('en-US', { 
					hour: '2-digit', 
					minute: '2-digit' 
				});
				
				const minutes = Math.floor(timeDiff / (1000 * 60));
				const seconds = Math.floor((timeDiff % (1000 * 60)) / 1000);
				
				if (minutes > 0) {
					statusText += `⏰ Next sync: ${timeStr} (in ${minutes}m ${seconds}s)`;
				} else {
					statusText += `⏰ Next sync: ${timeStr} (in ${seconds}s)`;
				}
				statusReason = `next sync in ${minutes}m ${seconds}s`;
			} else {
				statusText += '⏰ Starting soon';
				statusReason = 'sync starting soon';
			}
		} else if (this.settings.autoSyncEnabled) {
			statusText += '🟢 Waiting';
			statusReason = 'auto sync enabled, waiting';
		} else {
			statusText += '🟢 No sync scheduled';
			statusReason = 'auto sync disabled';
		}

		// Add error count (if there are errors)
		if (this.syncStatus.errorCount && this.syncStatus.errorCount > 0) {
			statusText += ` ⚠️${this.syncStatus.errorCount}`;
			statusReason += `, ${this.syncStatus.errorCount} errors`;
		}

		console.log('[StatusBar] Setting status text:', {
			statusText,
			statusReason,
			previousText: this.statusBarItem.getText ? this.statusBarItem.getText() : 'unknown',
			timestamp: new Date().toISOString()
		});

		this.statusBarItem.setText(statusText);
		
		console.log('[StatusBar] Status bar updated successfully:', {
			finalText: statusText,
			timestamp: new Date().toISOString()
		});
	}

	private logError(message: string, error: any): void {
		const log: SyncLog = {
			timestamp: new Date(),
			level: 'error',
			message,
			details: error
		};
		this.errorLogs.unshift(log);
		
		// Keep only last 100 logs
		if (this.errorLogs.length > 100) {
			this.errorLogs = this.errorLogs.slice(0, 100);
		}
	}

	private addOperation(operation: SyncOperation): void {
		this.recentOperations.unshift(operation);
		
		// Keep only last 50 operations
		if (this.recentOperations.length > 50) {
			this.recentOperations = this.recentOperations.slice(0, 50);
		}
	}

	private async activateView(viewType: string): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const leaves = workspace.getLeavesOfType(viewType);

		if (leaves.length > 0) {
			// A leaf with our view already exists, use that
			leaf = leaves[0];
		} else {
			// Our view could not be found in the workspace, create a new leaf
			// in the right sidebar for it
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({ type: viewType, active: true });
		}

		// "Reveal" the leaf in case it is in a collapsed sidebar
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}
}
