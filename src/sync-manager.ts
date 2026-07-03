import { TFile, TFolder, Vault, Notice, App } from 'obsidian';
import { OZSyncClient } from './ozsync-client';
import { OZSyncSettings, SyncStatus, SyncOperation, OZSyncFile } from './types';
import { format } from 'date-fns';

/**
 * OBSIDIAN VAULT STRUCTURE AND AUTO-SYNC EXPLANATION
 * 
 * 1. WHAT IS AN OBSIDIAN VAULT?
 *    An Obsidian vault is a DIRECTORY (folder) on your computer that contains:
 *    - Markdown files (.md) - your notes and documents
 *    - Attachments (images, PDFs, etc.) in various formats
 *    - Configuration files in the .obsidian subdirectory
 *    - Subdirectories to organize your content
 * 
 * 2. VAULT LOCATION:
 *    The vault directory is located at: /Users/liangjianli/Documents/oasis/
 *    This is the root directory that contains all your Obsidian content.
 * 
 * 3. AUTO-SYNC FUNCTIONALITY:
 *    When auto-sync is enabled, this plugin:
 *    - Monitors ALL files within the vault directory
 *    - Automatically uploads changed files to OZSync cloud storage
 *    - Runs at regular intervals (configurable in settings)
 *    - Syncs to user-selected directory on OZSync
 * 
 * 4. SYNC SCOPE AND BEHAVIOR:
 *    - WHAT GETS SYNCED: All markdown files (.md) and attachments in the vault
 *    - WHERE IT GOES: Files are uploaded to user-selected directory on OZSync
 *    - WHEN IT SYNCS: Automatically at set intervals when auto-sync is enabled
 *    - EXCLUSIONS: System files (.obsidian folder) are automatically excluded
 * 
 * 5. FILE STRUCTURE MAPPING:
 *    Local vault: /Users/liangjianli/Documents/oasis/MyNote.md
 *    Remote path: {syncDirectory}/MyNote.md
 *    
 *    Local vault: /Users/liangjianli/Documents/oasis/Folder/SubNote.md
 *    Remote path: {syncDirectory}/Folder/SubNote.md
 */

export class SyncManager {
	private vault: Vault;
	private client: OZSyncClient;
	private settings: OZSyncSettings;
	private syncStatus: SyncStatus;
	private syncOperations: SyncOperation[] = [];
	private syncInterval: number | null = null;
	private addLog: (log: any) => void;
	private onStatusUpdate?: (status: Partial<SyncStatus>) => void;

	constructor(client: OZSyncClient, settings: OZSyncSettings, addLog: (log: any) => void, onStatusUpdate?: (status: Partial<SyncStatus>) => void) {
		this.client = client;
		this.settings = settings;
		this.addLog = addLog;
		this.onStatusUpdate = onStatusUpdate;
		this.vault = (window as any).app.vault;
		this.syncStatus = {
			isConnected: false,
			syncInProgress: false,
			status: 'idle',
			pendingFiles: 0,
			processedFiles: 0,
			totalFiles: 0,
			syncSpeed: 0,
			bytesTransferred: 0,
			totalBytes: 0,
			errorCount: 0,
			startTime: undefined
		};
	}

	/**
	 * Initialize sync manager
	 */
	async initialize(): Promise<void> {
		try {
			// Don't auto-test connection on plugin startup to avoid unnecessary API requests
			// Connection test will be performed when user actively operates
			this.syncStatus.isConnected = false;
			
			console.log('OZSync: Manager initialized (connection will be tested when needed)');
		} catch (error) {
			console.error('Failed to initialize sync manager:', error);
		}
	}

	/**
	 * Test connection to OZSync server
	 */
	async testConnection(): Promise<boolean> {
		try {
			console.log('[SyncManager] Testing connection to OZSync server...');
			console.log('[SyncManager] Current sync status before test:', {
				isConnected: this.syncStatus.isConnected,
				clientExists: !!this.client,
				timestamp: new Date().toISOString()
			});
			
			console.log('[SyncManager] Calling client.testConnection()...');
			const connectionResult = await this.client.testConnection();
			console.log('[SyncManager] Client testConnection returned:', connectionResult);
			
			this.syncStatus.isConnected = connectionResult;
			
			console.log('[SyncManager] Connection test result:', {
				isConnected: this.syncStatus.isConnected,
				connectionResult,
				timestamp: new Date().toISOString()
			});
			
			if (this.syncStatus.isConnected) {
				console.log('[SyncManager] Connection successful, ensuring sync directory...');
				// After successful connection, ensure sync directory exists
				await this.ensureSyncDirectory();
				console.log('[SyncManager] Sync directory ensured');
				
				// Note: Auto sync is managed by main plugin, not started here
				console.log('[SyncManager] Connection successful - auto sync will be managed by main plugin');
				
				new Notice('OZSync: Connection test successful');
			} else {
				console.log('[SyncManager] Connection test failed - no connection established');
				new Notice('OZSync: Connection test failed');
			}
			
			// Notify main plugin of connection status update
			console.log('[SyncManager] Notifying main plugin of connection status:', {
				isConnected: this.syncStatus.isConnected,
				hasCallback: !!this.onStatusUpdate,
				callbackFunction: this.onStatusUpdate,
				timestamp: new Date().toISOString()
			});
			
			if (this.onStatusUpdate) {
				console.log('[SyncManager] Calling onStatusUpdate callback...');
				this.onStatusUpdate({ isConnected: this.syncStatus.isConnected });
				console.log('[SyncManager] onStatusUpdate callback called successfully');
			} else {
				console.warn('[SyncManager] No onStatusUpdate callback available!');
			}
			
			return this.syncStatus.isConnected;
		} catch (error) {
			console.error('[SyncManager] Connection test failed with error:', error);
			console.error('[SyncManager] Error details:', {
				errorMessage: error.message,
				errorStack: error.stack,
				timestamp: new Date().toISOString()
			});
			
			this.syncStatus.isConnected = false;
			// Notify main plugin of connection status update
			console.log('[SyncManager] Notifying main plugin of connection failure');
			if (this.onStatusUpdate) {
				this.onStatusUpdate({ isConnected: false });
			} else {
				console.warn('[SyncManager] No onStatusUpdate callback available for error notification!');
			}
			new Notice('OZSync: Connection test failed');
			return false;
		}
	}

	/**
	 * Start automatic synchronization
	 * 
	 * AUTO-SYNC WORKING PRINCIPLE:
	 * 1. Creates a timer that runs at user-defined intervals (default: every 15 minutes)
	 * 2. Each timer tick triggers performSync() which:
	 *    - Scans the entire vault directory for changes
	 *    - Compares local file modification times with remote versions
	 *    - Uploads only files that have been modified since last sync
	 * 3. Respects user exclusion settings (folders/file types to skip)
	 * 4. Runs continuously until manually stopped or plugin disabled
	 */
	startAutoSync(): void {
		if (this.syncInterval) {
			clearInterval(this.syncInterval);
		}
		
		const intervalMs = this.settings.syncInterval * 60 * 1000; // Convert minutes to milliseconds
		
		// Calculate and set next sync time
		this.updateNextSyncTime();
		
		this.syncInterval = window.setInterval(() => {
			this.performSync();
			// Update next sync time after each sync
			this.updateNextSyncTime();
		}, intervalMs);
		
		console.log(`Auto sync started with interval: ${this.settings.syncInterval} minutes`);
		console.log(`Next sync scheduled for: ${this.syncStatus.nextSyncTime?.toLocaleString()}`);
	}

	/**
	 * Stop automatic synchronization
	 */
	stopAutoSync(): void {
		if (this.syncInterval) {
			clearInterval(this.syncInterval);
			this.syncInterval = null;
			// Clear next sync time when auto sync is stopped
			this.syncStatus.nextSyncTime = undefined;
			console.log('Auto sync stopped');
		}
	}

	/**
	 * Update next sync time based on current settings
	 */
	private updateNextSyncTime(): void {
		if (this.settings.autoSyncEnabled && this.syncInterval) {
			const intervalMs = this.settings.syncInterval * 60 * 1000;
			this.syncStatus.nextSyncTime = new Date(Date.now() + intervalMs);
		} else {
			this.syncStatus.nextSyncTime = undefined;
		}
		// Notify main plugin of status update
		this.notifyStatusUpdate({ nextSyncTime: this.syncStatus.nextSyncTime });
	}

	/**
	 * Notify main plugin of status update
	 */
	private notifyStatusUpdate(updates: Partial<SyncStatus>): void {
		if (this.onStatusUpdate) {
			this.onStatusUpdate(updates);
		}
	}

	/**
	 * Perform synchronization
	 */
	async performSync(): Promise<void> {
		if (this.syncStatus.syncInProgress) {
			console.log('Sync already in progress, skipping');
			return;
		}

		this.syncStatus.syncInProgress = true;
		this.syncStatus.status = 'syncing';
		this.syncStatus.startTime = new Date();
		this.syncStatus.errorCount = 0;
		this.syncStatus.processedFiles = 0;
		this.syncStatus.bytesTransferred = 0;
		this.syncStatus.totalBytes = 0;

		try {
			// Ensure authentication before starting sync
			console.log('[SyncManager] Ensuring authentication before sync...');
			const authValid = await this.client.ensureValidToken();
			if (!authValid) {
				console.error('[SyncManager] Authentication failed, aborting sync');
				this.syncStatus.status = 'error';
				this.syncStatus.syncInProgress = false;
				new Notice('OZSync: Authentication failed. Please login manually.');
				return;
			}
			console.log('[SyncManager] Authentication valid, proceeding with sync');

			console.log('Starting bidirectional sync operation');

			// Get local files eligible for sync (exclusion filter only, no API calls)
			const localFiles = this.getFilesToSync();
			
			// Get all remote files
			const remoteFiles = await this.client.getAllFilesRecursive(this.settings.syncDirectory);
			
			// Create sync operations based on file comparison
			const syncOperations = await this.compareFiles(localFiles, remoteFiles);
			
			this.syncStatus.totalFiles = syncOperations.length;
			this.syncStatus.pendingFiles = syncOperations.length;

			if (syncOperations.length === 0) {
				console.log('No files need to be synced');
				this.syncStatus.status = 'idle';
				this.syncStatus.syncInProgress = false;
				this.syncStatus.lastSyncTime = new Date();
				return;
			}

			console.log(`Found ${syncOperations.length} sync operations to perform`);

			// Execute sync operations
			for (const operation of syncOperations) {
				try {
					if (operation.type === 'upload' && operation.file) {
					await this.syncFile(operation.file);
				} else if (operation.type === 'download' && operation.remotePath && operation.localPath) {
					await this.downloadFile(operation.remotePath, operation.localPath);
				}
					this.syncStatus.processedFiles++;
					this.syncStatus.pendingFiles--;
				} catch (error) {
					this.syncStatus.errorCount++;
					console.error(`Failed to ${operation.type} file: ${operation.file?.path || operation.remotePath}`, error);
				}
			}

			this.syncStatus.status = 'idle';
			this.syncStatus.lastSyncTime = new Date();
			console.log(`Bidirectional sync completed. Processed: ${this.syncStatus.processedFiles}, Errors: ${this.syncStatus.errorCount}`);

		} catch (error) {
			this.syncStatus.status = 'error';
			this.syncStatus.errorCount++;
			console.error('Sync operation failed', error);
		} finally {
			this.syncStatus.syncInProgress = false;
			this.notifyStatusUpdate({ syncInProgress: false });
		}
	}

	/**
	 * Get local files eligible for sync (exclusion filter only)
	 *
	 * Time comparison is done later in compareFiles() using the remote
	 * file listing from getAllFilesRecursive(), which already carries
	 * modification timestamps.  This method only filters out system
	 * folders (.obsidian, .trash) — no API calls are made here.
	 */
	private getFilesToSync(): TFile[] {
		const allFiles = this.vault.getFiles();
		const eligible: TFile[] = [];

		for (const file of allFiles) {
			if (!this.shouldExcludeFile(file)) {
				eligible.push(file);
			}
		}

		console.log(`[SyncManager] ${eligible.length} local files eligible for sync (after exclusion filter)`);
		return eligible;
	}

	/**
	 * Check if a file should be excluded from sync
	 * 
	 * EXCLUSION LOGIC:
	 * Only system folders are automatically excluded:
	 * - .obsidian/ (plugin configurations, not user content)
	 * - .trash/ (deleted files)
	 * This ensures all user content gets synced to OZSync
	 */
	private shouldExcludeFile(file: TFile): boolean {
		// Only exclude system folders
		const systemFolders = ['.obsidian/', '.trash/'];
		
		for (const systemFolder of systemFolders) {
			if (file.path.startsWith(systemFolder)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * Check if a single file needs synchronization.
	 *
	 * Uses the mediainfo API to check whether a file exists remotely.
	 * NOTE: the mediainfo API does NOT return modification timestamps,
	 * so this method can only tell whether the file exists — not
	 * whether it is outdated.  For proper time-based comparison use
	 * compareFiles() which relies on the file listing API that carries
	 * modified timestamps.
	 */
	private async needsSync(file: TFile): Promise<boolean> {
		try {
			const remotePath = this.getRemotePath(file.path);
			const remoteStats = await this.client.getFileStatsV2([remotePath], false);

			// mediainfo returns an array; if the file doesn't exist the
			// entry is null or absent
			if (!remoteStats || remoteStats.length === 0) {
				return true; // file missing remotely
			}

			const entry = remoteStats[0];
			if (!entry) return true;

			// The API returns { data: { items, size, type } } per path.
			// "items" is 0 for an empty file and >0 for directories.
			// Without a modified timestamp we conservatively assume
			// the file may need sync — the real comparison happens in
			// compareFiles() using the listing API.
			return true;
		} catch (error: any) {
			// On error (network, auth, 404, 500) assume the file needs sync
			// rather than silently skipping it.
			return true;
		}
	}

	/**
	 * Sync a single file
	 */
	private async syncFile(file: TFile): Promise<void> {
		try {
			const operation: SyncOperation = {
				id: this.generateOperationId(),
				type: 'upload',
				filePath: file.path,
				status: 'in-progress',
				progress: 0,
				timestamp: new Date()
			};
			
			this.syncOperations.push(operation);
			
			console.log('[Sync Manager] Starting file sync:', {
				filePath: file.path,
				fileSize: file.stat.size,
				fileExtension: file.extension,
				operationId: operation.id
			});
			
			// Read file content
			let content: string | Buffer;
			if (file.extension === 'md') {
				content = await this.vault.read(file);
			} else {
				const arrayBuffer = await this.vault.readBinary(file);
				content = Buffer.from(arrayBuffer);
			}
			
			// Get target directory path (without filename)
			const remotePath = this.getRemotePath(file.path);
			const targetDir = remotePath.substring(0, remotePath.lastIndexOf('/'));
			
			console.log('[Sync Manager] File sync paths:', {
				localPath: file.path,
				remotePath,
				targetDir,
				contentSize: content instanceof Buffer ? content.length : content.length
			});
			
			// Ensure target directory exists
			if (targetDir && !(await this.client.fileExistsV2(targetDir))) {
				console.log('[Sync Manager] Creating target directory:', targetDir);
				await this.client.createDirectory(targetDir);
			}
			
			// Upload to OZSync using new API
			const success = await this.client.uploadFileV2(targetDir, file.name, content);
			
			operation.status = success ? 'completed' : 'failed';
			operation.progress = 100;
			
			if (success) {
				this.syncStatus.bytesTransferred += file.stat.size;
				console.log('[Sync Manager] File sync completed:', {
					filePath: file.path,
					bytesTransferred: file.stat.size,
					totalBytesTransferred: this.syncStatus.bytesTransferred
				});
			} else {
				operation.error = 'Upload failed';
				this.syncStatus.errorCount++;
				console.error('[Sync Manager] File sync failed:', {
					filePath: file.path,
					reason: 'Upload returned false'
				});
			}
		} catch (error: any) {
			const errorDetails = {
				methodName: 'syncFile',
				filePath: file.path,
				fileSize: file.stat.size,
				fileExtension: file.extension,
				remotePath: this.getRemotePath(file.path),
				message: error.message,
				status: error.response?.status,
				responseData: error.response?.data,
				stack: error.stack
			};
			
			console.error('[Sync Manager] Failed to sync file:', {
				timestamp: new Date().toISOString(),
				...errorDetails
			});
			
			this.addLog({
				type: 'error',
				message: `Failed to sync file: ${file.path}`,
				details: errorDetails,
				timestamp: new Date().toISOString()
			});
			
			this.syncStatus.errorCount++;
		}
	}

	/**
	 * Compare local and remote files to determine sync operations
	 */
	private async compareFiles(localFiles: TFile[], remoteFiles: OZSyncFile[]): Promise<SyncOperation[]> {
		const operations: SyncOperation[] = [];
		
		// Create maps for easier lookup
		const localFileMap = new Map<string, TFile>();
		const remoteFileMap = new Map<string, OZSyncFile>();
		
		// Map local files by their remote path
		for (const file of localFiles) {
			const remotePath = this.getRemotePath(file.path);
			localFileMap.set(remotePath, file);
		}
		
		// Map remote files by their path
		for (const file of remoteFiles) {
			remoteFileMap.set(file.path, file);
		}
		
		// Check local files against remote files
		for (const [remotePath, localFile] of localFileMap) {
			const remoteFile = remoteFileMap.get(remotePath);
			
			if (!remoteFile) {
				// Local file doesn't exist on remote - upload
				operations.push({
					id: `upload-${localFile.path}`,
					type: 'upload',
					filePath: localFile.path,
					status: 'pending',
					progress: 0,
					timestamp: new Date(),
					file: localFile
				});
			} else {
				// Both files exist - apply conflict resolution strategy
				const localModified = localFile.stat.mtime;
				const remoteModified = remoteFile.lastModified;
				
				// Apply conflict resolution strategy
				if (this.settings.conflictResolution === 'local') {
					// 以本地为准 - 总是上传本地文件
					if (localModified !== remoteModified) {
						operations.push({
							id: `upload-${localFile.path}`,
							type: 'upload',
							filePath: localFile.path,
							status: 'pending',
							progress: 0,
							timestamp: new Date(),
							file: localFile
						});
					}
				} else if (this.settings.conflictResolution === 'remote') {
					// 以服务器为准 - 总是下载远程文件
					if (localModified !== remoteModified) {
						operations.push({
							id: `download-${remotePath}`,
							type: 'download',
							filePath: localFile.path,
							status: 'pending',
							progress: 0,
							timestamp: new Date(),
							remotePath: remotePath,
							localPath: localFile.path
						});
					}
				} else {
					// 默认行为：基于时间戳比较
					if (localModified > remoteModified) {
						// Local file is newer - upload
						operations.push({
							id: `upload-${localFile.path}`,
							type: 'upload',
							filePath: localFile.path,
							status: 'pending',
							progress: 0,
							timestamp: new Date(),
							file: localFile
						});
					} else if (remoteModified > localModified) {
						// Remote file is newer - download
						operations.push({
							id: `download-${remotePath}`,
							type: 'download',
							filePath: localFile.path,
							status: 'pending',
							progress: 0,
							timestamp: new Date(),
							remotePath: remotePath,
							localPath: localFile.path
						});
					}
				}
				// If modification times are equal, no sync needed
			}
		}
		
		// Check for remote files that don't exist locally
		for (const [remotePath, remoteFile] of remoteFileMap) {
			if (!localFileMap.has(remotePath) && !remoteFile.isDirectory) {
				// Remote file doesn't exist locally - download (skip directories)
				const localPath = this.getLocalPath(remotePath);
				operations.push({
					id: `download-${remotePath}`,
					type: 'download',
					filePath: localPath,
					status: 'pending',
					progress: 0,
					timestamp: new Date(),
					remotePath: remotePath,
					localPath: localPath
				});
			}
		}
		
		return operations;
	}
	
	/**
	 * Download a file from remote to local
	 */
	private async downloadFile(remotePath: string, localPath: string): Promise<void> {
		try {
			console.log(`Downloading file: ${remotePath} -> ${localPath}`);
			
			// Download file content from OZSync
			const content = await this.client.downloadFile(remotePath);
			
			if (content === null) {
				throw new Error('Failed to download file content');
			}
			
			// Ensure parent directory exists
			const parentDir = localPath.substring(0, localPath.lastIndexOf('/'));
			if (parentDir && !(await this.vault.adapter.exists(parentDir))) {
				await this.vault.adapter.mkdir(parentDir);
			}
			
			// Write file to vault
			if (await this.vault.adapter.exists(localPath)) {
				// File exists, modify it
				await this.vault.adapter.write(localPath, content);
			} else {
				// File doesn't exist, create it
				await this.vault.create(localPath, content);
			}
			
			console.log(`File downloaded successfully: ${localPath}`);
			
		} catch (error) {
			console.error(`Failed to download file: ${remotePath}`, error);
			throw error;
		}
	}
	
	/**
	 * Convert remote path to local path
	 */
	private getLocalPath(remotePath: string): string {
		// Remove the sync directory prefix from remote path
		const syncDir = this.settings.syncDirectory;
		if (remotePath.startsWith(syncDir)) {
			return remotePath.substring(syncDir.length + 1); // +1 for the trailing slash
		}
		return remotePath;
	}
	
	/**
	 * Update sync speed calculation
	 */
	private updateSyncSpeed(): void {
		if (!this.syncStatus.startTime) return;
		
		const elapsedMs = Date.now() - this.syncStatus.startTime.getTime();
		const elapsedSeconds = elapsedMs / 1000;
		
		if (elapsedSeconds > 0) {
			this.syncStatus.syncSpeed = this.syncStatus.bytesTransferred / elapsedSeconds;
		}
	}



	/**
	 * Get remote path for a local file
	 * Uses the configured sync directory directly without modification
	 */
	private getRemotePath(localPath: string): string {
		// Use the sync directory as configured by the user
		const syncDir = this.settings.syncDirectory || '/media/OZSync-HD/Obsidian';
		
		// Remove leading slash from localPath if present
		const cleanLocalPath = localPath.startsWith('/') ? localPath.substring(1) : localPath;
		
		// Combine paths with proper separator, avoiding double slashes
		const remotePath = syncDir.endsWith('/') ? 
			`${syncDir}${cleanLocalPath}` : 
			`${syncDir}/${cleanLocalPath}`;
		
		console.log('[Sync Manager] Path mapping:', {
			localPath,
			cleanLocalPath,
			syncDir,
			remotePath
		});
		
		return remotePath;
	}

	/**
	 * Ensure sync directory exists
	 */
	private async ensureSyncDirectory(): Promise<void> {
		if (!this.settings.syncDirectory) {
			console.warn('[Sync Manager] No sync directory configured');
			return;
		}
		
		try {
			// Use the sync directory as configured by the user
			const syncDir = this.settings.syncDirectory;
			
			console.log('[Sync Manager] Checking sync directory:', {
				syncDirectory: syncDir
			});
			
			if (!(await this.client.fileExistsV2(syncDir))) {
				console.log('[Sync Manager] Creating sync directory:', syncDir);
				await this.client.createDirectory(syncDir);
				console.log('[Sync Manager] Sync directory created successfully');
			} else {
				console.log('[Sync Manager] Sync directory already exists');
			}
		} catch (error: any) {
			const errorDetails = {
				methodName: 'ensureSyncDirectory',
				syncDirectory: this.settings.syncDirectory,
				message: error.message,
				status: error.response?.status,
				responseData: error.response?.data,
				stack: error.stack
			};
			
			console.error('[Sync Manager] Failed to ensure sync directory:', {
				timestamp: new Date().toISOString(),
				...errorDetails
			});
			
			this.addLog({
				type: 'error',
				message: 'Failed to ensure sync directory exists',
				details: errorDetails,
				timestamp: new Date().toISOString()
			});
			
			throw error;
		}
	}









	/**
	 * Generate operation ID
	 */
	private generateOperationId(): string {
		return Date.now().toString(36) + Math.random().toString(36).substr(2);
	}



	/**
	 * Format file size
	 */
	private formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	/**
	 * Get sync status
	 */
	getSyncStatus(): SyncStatus {
		return { ...this.syncStatus };
	}

	/**
	 * Get sync operations
	 */
	getSyncOperations(): SyncOperation[] {
		return [...this.syncOperations];
	}



	/**
	 * Update settings
	 */
	updateSettings(settings: OZSyncSettings): void {
		this.settings = settings;
		
		// Restart auto sync if settings changed
		if (settings.autoSyncEnabled) {
			this.startAutoSync();
		} else {
			this.stopAutoSync();
		}
	}

	/**
	 * Cleanup
	 */
	destroy(): void {
		this.stopAutoSync();
	}
}