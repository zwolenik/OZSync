import { ItemView, WorkspaceLeaf, Notice, TFile, TFolder, Modal, Setting } from 'obsidian';
import OZSyncPlugin from '../../main';
import { OZSyncFile } from '../types';
import { format } from 'date-fns';

export const CLOUD_BROWSER_VIEW_TYPE = 'ozsync-cloud-browser';

export class CloudBrowserView extends ItemView {
	plugin: OZSyncPlugin;
	private currentPath: string = '/';
	private files: OZSyncFile[] = [];
	private selectedFiles: Set<string> = new Set();
	private loading: boolean = false;

	constructor(leaf: WorkspaceLeaf, plugin: OZSyncPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return CLOUD_BROWSER_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'OZSync Cloud Browser';
	}

	getIcon(): string {
		return 'cloud';
	}

	async onOpen(): Promise<void> {
		await this.loadFiles();
		this.renderView();
	}

	private async loadFiles(): Promise<void> {
		this.loading = true;
		try {
			const directories = await this.plugin.ozsyncClient.listDirectories(this.currentPath);
			// Convert OZSyncDirectory to OZSyncFile format
			this.files = directories.map(dir => ({
				name: dir.name,
				path: dir.path,
				size: dir.size || 0,
				lastModified: dir.lastModified ? dir.lastModified.getTime() : Date.now(),
				isDirectory: dir.isDirectory,
				mimeType: dir.isDirectory ? 'directory' : undefined,
				modified: dir.lastModified ? dir.lastModified.toISOString() : new Date().toISOString()
			}));
		} catch (error) {
			console.error('Failed to load files:', error);
			new Notice('Failed to load files from OZSync');
			this.files = [];
		}
		this.loading = false;
	}

	private renderView(): void {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass('ozsync-cloud-browser');

		// Header
		this.renderHeader(container as HTMLElement);

		// Navigation
		this.renderNavigation(container as HTMLElement);

		// Toolbar
		this.renderToolbar(container as HTMLElement);

		// File List
		this.renderFileList(container as HTMLElement);

		// Footer
		this.renderFooter(container as HTMLElement);
	}

	private renderHeader(container: HTMLElement): void {
		const header = container.createEl('div', { cls: 'browser-header' });
		header.createEl('h2', { text: 'OZSync Cloud Browser' });
		
		const refreshBtn = header.createEl('button', { 
			text: '🔄 Refresh',
			cls: 'mod-cta'
		});
		refreshBtn.onclick = async () => {
			await this.loadFiles();
			this.renderView();
		};
	}

	private renderNavigation(container: HTMLElement): void {
		const nav = container.createEl('div', { cls: 'browser-navigation' });
		
		// Breadcrumb
		const breadcrumb = nav.createEl('div', { cls: 'breadcrumb' });
		const pathParts = this.currentPath.split('/').filter(part => part);
		
		// Root
		const rootBtn = breadcrumb.createEl('button', { 
			text: '🏠 Root',
			cls: 'breadcrumb-item'
		});
		rootBtn.onclick = () => this.navigateTo('/');
		
		// Path parts
		let currentPath = '';
		pathParts.forEach((part, index) => {
			currentPath += '/' + part;
			breadcrumb.createEl('span', { text: ' / ', cls: 'breadcrumb-separator' });
			
			const partBtn = breadcrumb.createEl('button', { 
				text: part,
				cls: 'breadcrumb-item'
			});
			
			if (index < pathParts.length - 1) {
				const pathToNavigate = currentPath;
				partBtn.onclick = () => this.navigateTo(pathToNavigate);
			} else {
				partBtn.addClass('current');
			}
		});

		// Back button
		if (this.currentPath !== '/') {
			const backBtn = nav.createEl('button', { 
				text: '← Back',
				cls: 'back-button'
			});
			backBtn.onclick = () => {
				const parentPath = this.currentPath.split('/').slice(0, -1).join('/') || '/';
				this.navigateTo(parentPath);
			};
		}
	}

	private renderToolbar(container: HTMLElement): void {
		const toolbar = container.createEl('div', { cls: 'browser-toolbar' });
		
		// Selection info
		const selectionInfo = toolbar.createEl('div', { cls: 'selection-info' });
		if (this.selectedFiles.size > 0) {
			selectionInfo.textContent = `${this.selectedFiles.size} file(s) selected`;
		} else {
			selectionInfo.textContent = `${this.files.length} item(s)`;
		}

		// Actions
		const actions = toolbar.createEl('div', { cls: 'toolbar-actions' });

		// Select All / Deselect All
		const selectBtn = actions.createEl('button', { 
			text: this.selectedFiles.size === this.files.length ? 'Deselect All' : 'Select All',
			cls: 'toolbar-button'
		});
		selectBtn.onclick = () => {
			if (this.selectedFiles.size === this.files.length) {
				this.selectedFiles.clear();
			} else {
				this.files.forEach(file => this.selectedFiles.add(file.path));
			}
			this.renderView();
		};

		// Download Selected
		if (this.selectedFiles.size > 0) {
			const downloadBtn = actions.createEl('button', { 
				text: '⬇️ Download',
				cls: 'toolbar-button mod-cta'
			});
			downloadBtn.onclick = () => this.downloadSelected();

			// Delete Selected
			const deleteBtn = actions.createEl('button', { 
				text: '🗑️ Delete',
				cls: 'toolbar-button mod-warning'
			});
			deleteBtn.onclick = () => this.deleteSelected();
		}

		// Upload
		const uploadBtn = actions.createEl('button', { 
			text: '⬆️ Upload',
			cls: 'toolbar-button'
		});
		uploadBtn.onclick = () => this.showUploadModal();

		// Create Folder
		const createFolderBtn = actions.createEl('button', { 
			text: '📁 New Folder',
			cls: 'toolbar-button'
		});
		createFolderBtn.onclick = () => this.showCreateFolderModal();
	}

	private renderFileList(container: HTMLElement): void {
		const listContainer = container.createEl('div', { cls: 'file-list-container' });
		
		if (this.loading) {
			listContainer.createEl('div', { 
				text: '🔄 Loading...',
				cls: 'loading-message'
			});
			return;
		}

		if (this.files.length === 0) {
			listContainer.createEl('div', { 
				text: '📂 This folder is empty',
				cls: 'empty-message'
			});
			return;
		}

		// File list header
		const header = listContainer.createEl('div', { cls: 'file-list-header' });
		header.createEl('div', { text: 'Name', cls: 'header-name' });
		header.createEl('div', { text: 'Size', cls: 'header-size' });
		header.createEl('div', { text: 'Modified', cls: 'header-modified' });
		header.createEl('div', { text: 'Actions', cls: 'header-actions' });

		// File list
		const fileList = listContainer.createEl('div', { cls: 'file-list' });
		
		this.files.forEach(file => {
			const fileItem = fileList.createEl('div', { 
				cls: `file-item ${this.selectedFiles.has(file.path) ? 'selected' : ''}` 
			});

			// Checkbox
			const checkbox = fileItem.createEl('input', { type: 'checkbox' });
			checkbox.checked = this.selectedFiles.has(file.path);
			checkbox.onchange = () => {
				if (checkbox.checked) {
					this.selectedFiles.add(file.path);
				} else {
					this.selectedFiles.delete(file.path);
				}
				this.renderView();
			};

			// Icon and name
			const nameCell = fileItem.createEl('div', { cls: 'file-name' });
			const icon = file.isDirectory ? '📁' : this.getFileIcon(file.name);
			nameCell.createEl('span', { text: icon, cls: 'file-icon' });
			
			const nameSpan = nameCell.createEl('span', { 
				text: file.name,
				cls: 'file-name-text'
			});
			
			if (file.isDirectory) {
				nameSpan.onclick = () => this.navigateTo(file.path);
				nameSpan.addClass('clickable');
			}

			// Size
			fileItem.createEl('div', { 
				text: file.isDirectory ? '-' : this.formatFileSize(file.size || 0),
				cls: 'file-size'
			});

			// Modified date
			fileItem.createEl('div', { 
				text: file.lastModified ? format(file.lastModified, 'yyyy-MM-dd HH:mm') : '-',
				cls: 'file-modified'
			});

			// Actions
			const actionsCell = fileItem.createEl('div', { cls: 'file-actions' });
			
			if (!file.isDirectory) {
				// Download
				const downloadBtn = actionsCell.createEl('button', { 
					text: '⬇️',
					cls: 'action-button',
					attr: { title: 'Download' }
				});
				downloadBtn.onclick = () => this.downloadFile(file);

				// Preview (for images and text files)
				if (this.isPreviewable(file.name)) {
					const previewBtn = actionsCell.createEl('button', { 
						text: '👁️',
						cls: 'action-button',
						attr: { title: 'Preview' }
					});
					previewBtn.onclick = () => this.previewFile(file);
				}
			}

			// Delete
			const deleteBtn = actionsCell.createEl('button', { 
				text: '🗑️',
				cls: 'action-button delete-button',
				attr: { title: 'Delete' }
			});
			deleteBtn.onclick = () => this.deleteFile(file);
		});
	}

	private renderFooter(container: HTMLElement): void {
		const footer = container.createEl('div', { cls: 'browser-footer' });
		
		const info = footer.createEl('div', { cls: 'footer-info' });
		const totalFiles = this.files.filter(f => !f.isDirectory).length;
		const totalFolders = this.files.filter(f => f.isDirectory).length;
		
		info.textContent = `${totalFolders} folder(s), ${totalFiles} file(s)`;
		
		if (this.selectedFiles.size > 0) {
			info.textContent += ` | ${this.selectedFiles.size} selected`;
		}
	}

	private async navigateTo(path: string): Promise<void> {
		this.currentPath = path;
		this.selectedFiles.clear();
		await this.loadFiles();
		this.renderView();
	}

	private async downloadSelected(): Promise<void> {
		if (this.selectedFiles.size === 0) return;
		
		const selectedFileObjects = this.files.filter(f => this.selectedFiles.has(f.path));
		
		for (const file of selectedFileObjects) {
			if (!file.isDirectory) {
				await this.downloadFile(file);
			}
		}
		
		new Notice(`Downloaded ${selectedFileObjects.length} file(s)`);
	}

	private async downloadFile(file: OZSyncFile): Promise<void> {
		try {
			const data = await this.plugin.ozsyncClient.downloadFile(file.path);

			const fileName = file.name;
			const filePath = `Downloads/${fileName}`;

			const downloadsFolder = this.app.vault.getAbstractFileByPath('Downloads');
			if (!downloadsFolder) {
				await this.app.vault.createFolder('Downloads');
			}

			if (data !== null) {
				const ext = fileName.split('.').pop()?.toLowerCase() || '';
				const textExts = ['md','txt','csv','json','yaml','yml','html','css','js','canvas','xml'];
				if (textExts.includes(ext)) {
					const text = new TextDecoder('utf-8').decode(data);
					await this.app.vault.create(filePath, text);
				} else {
					await this.app.vault.createBinary(filePath, data);
				}
			}
			new Notice(`Downloaded: ${fileName}`);
		} catch (error) {
			console.error('Download failed:', error);
			new Notice(`Failed to download: ${file.name}`);
		}
	}

	private async deleteSelected(): Promise<void> {
		if (this.selectedFiles.size === 0) return;
		
		const confirmed = await this.showConfirmDialog(
			`Are you sure you want to delete ${this.selectedFiles.size} selected item(s)?`
		);
		
		if (!confirmed) return;
		
		const selectedFileObjects = this.files.filter(f => this.selectedFiles.has(f.path));
		
		for (const file of selectedFileObjects) {
			await this.deleteFile(file, false);
		}
		
		this.selectedFiles.clear();
		await this.loadFiles();
		this.renderView();
		
		new Notice(`Deleted ${selectedFileObjects.length} item(s)`);
	}

	private async deleteFile(file: OZSyncFile, confirm: boolean = true): Promise<void> {
		if (confirm) {
			const confirmed = await this.showConfirmDialog(
				`Are you sure you want to delete "${file.name}"?`
			);
			if (!confirmed) return;
		}
		
		try {
				await this.plugin.ozsyncClient.deleteFile(file.path);
			
			if (confirm) {
				await this.loadFiles();
				this.renderView();
				new Notice(`Deleted: ${file.name}`);
			}
		} catch (error) {
			console.error('Delete failed:', error);
			new Notice(`Failed to delete: ${file.name}`);
		}
	}

	private showUploadModal(): void {
		new UploadModal(this.app, this.plugin, this.currentPath, () => {
			this.loadFiles().then(() => this.renderView());
		}).open();
	}

	private showCreateFolderModal(): void {
		new CreateFolderModal(this.app, this.plugin, this.currentPath, () => {
			this.loadFiles().then(() => this.renderView());
		}).open();
	}

	private async previewFile(file: OZSyncFile): Promise<void> {
		try {
			const data = await this.plugin.ozsyncClient.downloadFile(file.path);
			if (data !== null) {
				new PreviewModal(this.app, file, data).open();
			} else {
				new Notice(`Failed to load content for: ${file.name}`);
			}
		} catch (error) {
			console.error('Preview failed:', error);
			new Notice(`Failed to preview: ${file.name}`);
		}
	}

	private async showConfirmDialog(message: string): Promise<boolean> {
		return new Promise((resolve) => {
			new ConfirmModal(this.app, message, resolve).open();
		});
	}

	private getFileIcon(fileName: string): string {
		const ext = fileName.split('.').pop()?.toLowerCase();
		
		switch (ext) {
			case 'md': return '📝';
			case 'txt': return '📄';
			case 'pdf': return '📕';
			case 'jpg': case 'jpeg': case 'png': case 'gif': case 'webp': return '🖼️';
			case 'mp4': case 'avi': case 'mov': case 'mkv': return '🎬';
			case 'mp3': case 'wav': case 'flac': case 'aac': return '🎵';
			case 'zip': case 'rar': case '7z': case 'tar': return '📦';
			case 'js': case 'ts': case 'py': case 'java': case 'cpp': return '💻';
			default: return '📄';
		}
	}

	private isPreviewable(fileName: string): boolean {
		const ext = fileName.split('.').pop()?.toLowerCase();
		return ['md', 'txt', 'json', 'js', 'ts', 'py', 'html', 'css', 'jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '');
	}

	private formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}
}

// Upload Modal
class UploadModal extends Modal {
	plugin: OZSyncPlugin;
	currentPath: string;
	onSuccess: () => void;

	constructor(app: any, plugin: OZSyncPlugin, currentPath: string, onSuccess: () => void) {
		super(app);
		this.plugin = plugin;
		this.currentPath = currentPath;
		this.onSuccess = onSuccess;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Upload Files' });

		// File input
		const fileInput = contentEl.createEl('input', { 
			type: 'file',
			attr: { multiple: 'true' }
		});

		// Upload from vault
		const vaultSection = contentEl.createEl('div', { cls: 'upload-section' });
		vaultSection.createEl('h3', { text: 'Upload from Vault' });
		
		const vaultFileSelect = vaultSection.createEl('select', { cls: 'vault-file-select' });
		vaultFileSelect.createEl('option', { text: 'Select a file...', value: '' });
		
		// Populate vault files
		this.app.vault.getFiles().forEach((file: TFile) => {
			vaultFileSelect.createEl('option', { text: file.path, value: file.path });
		});

		// Buttons
		const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
		
		const uploadBtn = buttonContainer.createEl('button', { 
			text: 'Upload',
			cls: 'mod-cta'
		});
		uploadBtn.onclick = async () => {
			await this.handleUpload(fileInput, vaultFileSelect);
		};
		
		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.onclick = () => this.close();
	}

	private async handleUpload(fileInput: HTMLInputElement, vaultFileSelect: HTMLSelectElement): Promise<void> {
		try {
			// Upload selected files
			if (fileInput.files && fileInput.files.length > 0) {
				for (const file of Array.from(fileInput.files)) {
					const content = await file.arrayBuffer();
					// targetPath应该是目录路径，不包含文件名
					const targetPath = this.currentPath;
					console.log('[Cloud Browser] Uploading file:', {
						fileName: file.name,
						targetPath,
						contentSize: content.byteLength
					});
					await this.plugin.ozsyncClient.uploadFileV2(targetPath, file.name, Buffer.from(content));
				}
				new Notice(`Uploaded ${fileInput.files.length} file(s)`);
			}
			
			// Upload from vault
			if (vaultFileSelect.value) {
				const vaultFile = this.app.vault.getAbstractFileByPath(vaultFileSelect.value) as TFile;
				if (vaultFile) {
					const content = await this.app.vault.readBinary(vaultFile);
					// targetPath应该是目录路径，不包含文件名
					const targetPath = this.currentPath;
					console.log('[Cloud Browser] Uploading vault file:', {
						fileName: vaultFile.name,
						targetPath,
						contentSize: content.byteLength
					});
					await this.plugin.ozsyncClient.uploadFileV2(targetPath, vaultFile.name, Buffer.from(content));
					new Notice(`Uploaded: ${vaultFile.name}`);
				}
			}
			
			this.onSuccess();
			this.close();
		} catch (error) {
			console.error('Upload failed:', error);
			new Notice('Upload failed');
		}
	}
}

// Create Folder Modal
class CreateFolderModal extends Modal {
	plugin: OZSyncPlugin;
	currentPath: string;
	onSuccess: () => void;

	constructor(app: any, plugin: OZSyncPlugin, currentPath: string, onSuccess: () => void) {
		super(app);
		this.plugin = plugin;
		this.currentPath = currentPath;
		this.onSuccess = onSuccess;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Create New Folder' });

		const folderNameInput = contentEl.createEl('input', { 
			type: 'text',
			placeholder: 'Folder name',
			cls: 'folder-name-input'
		});

		const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
		
		const createBtn = buttonContainer.createEl('button', { 
			text: 'Create',
			cls: 'mod-cta'
		});
		createBtn.onclick = async () => {
			await this.handleCreateFolder(folderNameInput.value);
		};
		
		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.onclick = () => this.close();
		
		// Enter key support
		folderNameInput.addEventListener('keypress', (e) => {
			if (e.key === 'Enter') {
				createBtn.click();
			}
		});
		
		folderNameInput.focus();
	}

	private async handleCreateFolder(folderName: string): Promise<void> {
		if (!folderName.trim()) {
			new Notice('Please enter a folder name');
			return;
		}
		
		try {
				const folderPath = `${this.currentPath}/${folderName.trim()}`.replace('//', '/');
				await this.plugin.ozsyncClient.createDirectory(folderPath);
			new Notice(`Created folder: ${folderName}`);
			this.onSuccess();
			this.close();
		} catch (error) {
			console.error('Create folder failed:', error);
			new Notice('Failed to create folder');
		}
	}
}

// Preview Modal
class PreviewModal extends Modal {
	file: OZSyncFile;
	content: ArrayBuffer;

	constructor(app: any, file: OZSyncFile, content: ArrayBuffer) {
		super(app);
		this.file = file;
		this.content = content;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: `Preview: ${this.file.name}` });

		const previewContainer = contentEl.createEl('div', { cls: 'preview-container' });
		
		const ext = this.file.name.split('.').pop()?.toLowerCase();
		
		if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) {
			// Image preview
			const blob = new Blob([this.content]);
			const url = URL.createObjectURL(blob);
			const img = previewContainer.createEl('img', { 
				attr: { src: url },
				cls: 'preview-image'
			});
			img.onload = () => URL.revokeObjectURL(url);
		} else {
			// Text preview
			const text = new TextDecoder().decode(this.content);
			const pre = previewContainer.createEl('pre', { 
				text: text,
				cls: 'preview-text'
			});
		}

		const closeBtn = contentEl.createEl('button', { 
			text: 'Close',
			cls: 'mod-cta'
		});
		closeBtn.onclick = () => this.close();
	}
}

// Confirm Modal
class ConfirmModal extends Modal {
	message: string;
	resolve: (result: boolean) => void;

	constructor(app: any, message: string, resolve: (result: boolean) => void) {
		super(app);
		this.message = message;
		this.resolve = resolve;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Confirm' });
		contentEl.createEl('p', { text: this.message });

		const buttonContainer = contentEl.createEl('div', { cls: 'modal-button-container' });
		
		const confirmBtn = buttonContainer.createEl('button', { 
			text: 'Confirm',
			cls: 'mod-warning'
		});
		confirmBtn.onclick = () => {
			this.resolve(true);
			this.close();
		};
		
		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.onclick = () => {
			this.resolve(false);
			this.close();
		};
	}

	onClose(): void {
		this.resolve(false);
	}
}