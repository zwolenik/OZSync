import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { OZSyncSettings, OZSyncFile, SyncLog, LoginResponse, TokenData, AuthState, OZSyncDirectory } from './types';
import { Notice } from 'obsidian';

export class OZSyncClient {
	private httpClient: AxiosInstance;
	private settings: OZSyncSettings;
	private logs: SyncLog[] = [];
	private authState: AuthState = { isAuthenticated: false };

	constructor(settings: OZSyncSettings) {
		this.settings = settings;
		this.initializeHttpClient();
		this.loadStoredAuth();
	}

	// Login method
	async login(username?: string, password?: string): Promise<boolean> {
		console.log('[OZSync Login] Starting login process', {
			timestamp: new Date().toISOString(),
			username: username || this.settings.username,
			hasPassword: !!(password || this.settings.password),
			serverUrl: this.settings.serverUrl,
			port: this.settings.port,
			useHttps: this.settings.useHttps,
			httpClientBaseURL: this.httpClient?.defaults?.baseURL
		});
		
		try {
			const loginData = {
				username: username || this.settings.username,
				password: password || this.settings.password
			};

			console.log('[OZSync Login] Preparing login data', {
				username: loginData.username,
				hasPassword: !!loginData.password,
				passwordLength: loginData.password?.length || 0
			});

			this.log('info', 'Attempting to login to OZSync', { 
				username: loginData.username, 
				serverUrl: this.settings.serverUrl,
				port: this.settings.port
			});
			
			const loginUrl = '/v1/users/login';
			
			console.log('[OZSync Login] Sending login request', {
				url: loginUrl,
				fullUrl: `${this.httpClient.defaults.baseURL}${loginUrl}`,
				username: loginData.username,
				requestMethod: 'POST',
				headers: { 'Content-Type': 'application/json' }
			});
			
			this.log('info', 'Sending login request', {
				url: loginUrl,
				fullUrl: `${this.httpClient.defaults.baseURL}${loginUrl}`,
				username: loginData.username
			});

			const response = await this.httpClient.post<LoginResponse>(loginUrl, loginData, {
				headers: {
					'Content-Type': 'application/json'
				}
			});
			
			console.log('[OZSync Login] Received login response', {
				status: response.status,
				statusText: response.statusText,
				hasData: !!response.data,
				responseData: response.data,
				successCode: response.data?.success
			});
			
			this.log('info', 'Login response received', { 
				status: response.status, 
				statusText: response.statusText,
				dataExists: !!response.data,
				dataDataExists: !!(response.data && response.data.data)
			});
			
			if (response.data.success === 200) {
				const tokenData = response.data.data.token;
				console.log('[OZSync Login] Login successful, processing token data', {
					hasAccessToken: !!tokenData.access_token,
					hasRefreshToken: !!tokenData.refresh_token,
					expiresAt: tokenData.expires_at,
					accessTokenPrefix: tokenData.access_token?.substring(0, 10) + '...',
					refreshTokenPrefix: tokenData.refresh_token?.substring(0, 10) + '...',
					userInfo: response.data.data.user
				});
				
				this.log('info', 'Token data received', { 
					hasAccessToken: !!tokenData.access_token,
					hasRefreshToken: !!tokenData.refresh_token,
					expiresAt: tokenData.expires_at
				});
				
				this.authState = {
					isAuthenticated: true,
					tokenData: tokenData,
					user: {
						id: response.data.data.user.id,
						username: response.data.data.user.username,
						role: response.data.data.user.role
					}
				};
				
				// Save token to local storage
			console.log('[OZSync Login] Saving authentication state to local storage');
				this.saveAuth();
				
				console.log('[OZSync Login] Login process completed', {
					username: loginData.username,
					isAuthenticated: this.authState.isAuthenticated,
					hasToken: !!this.authState.tokenData?.access_token
				});
				
				this.log('info', 'Login successful, auth state updated', { username: loginData.username });
				
				// Immediately notify connection status update after successful login
			console.log('[OZSync Login] Login successful, connection should be established');
				
				return true;
			} else {
				// Extract error message from API response
				const errorMessage = response.data.message || 'Login failed';
				console.error('[OZSync Login] Login failed', {
					successCode: response.data.success,
					errorMessage,
					responseData: response.data
				});
				this.log('error', errorMessage, response.data);
				// Show error notice with red styling
				this.showErrorNotice(errorMessage);
				return false;
			}
		} catch (error: any) {
			let errorMessage = 'Login request failed';
			
			// Extract error message from API response if available
			if (error.response?.data?.message) {
				errorMessage = error.response.data.message;
			} else if (error.message) {
				errorMessage = error.message;
			}
			
			console.error('[OZSync Login] Login request exception', {
				errorMessage,
				error: error.message,
				status: error.response?.status,
				statusText: error.response?.statusText,
				responseData: error.response?.data,
				code: error.code,
				stack: error.stack,
				config: {
					url: error.config?.url,
					method: error.config?.method,
					baseURL: error.config?.baseURL,
					headers: error.config?.headers
				}
			});
			
			this.log('error', errorMessage, { 
				error: error.message, 
				status: error.response?.status,
				statusText: error.response?.statusText,
				responseData: error.response?.data,
				code: error.code,
				config: {
					url: error.config?.url,
					method: error.config?.method,
					baseURL: error.config?.baseURL,
					headers: error.config?.headers
				}
			});
			this.showErrorNotice(errorMessage);
			return false;
		}
	}

	// Refresh token
	async refreshToken(): Promise<boolean> {
		try {
			if (!this.authState.tokenData?.refresh_token) {
				const errorMsg = 'No refresh token available';
				console.error('[OZSync Token Refresh] Error:', errorMsg);
				throw new Error(errorMsg);
			}

			const refreshUrl = '/v1/users/refresh';
			const requestData = {
				refresh_token: this.authState.tokenData.refresh_token
			};
			
			console.log('[OZSync Token Refresh] Attempting token refresh:', {
				url: refreshUrl,
				fullUrl: `${this.httpClient.defaults.baseURL}${refreshUrl}`,
				hasRefreshToken: !!this.authState.tokenData.refresh_token,
				tokenPrefix: this.authState.tokenData.refresh_token?.substring(0, 10) + '...'
			});

			const response = await this.httpClient.post(refreshUrl, requestData, {
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (response.data.success === 200) {
				this.authState.tokenData = response.data.data.token;
				this.saveAuth();
				console.log('[ZimaOS Token Refresh] Token refreshed successfully:', {
					newTokenPrefix: this.authState.tokenData?.access_token?.substring(0, 10) + '...',
					expiresAt: this.authState.tokenData?.expires_at
				});
				this.log('info', 'Token refreshed successfully');
				return true;
			} else {
				const errorMessage = response.data.message || 'Token refresh failed';
				const errorDetails = {
					status: response.status,
					statusText: response.statusText,
					responseData: response.data,
					message: errorMessage
				};
				console.error('[OZSync Token Refresh] API returned error:', errorDetails);
				this.log('error', 'Token refresh API error', errorDetails);
				this.showErrorNotice(errorMessage);
				throw new Error(errorMessage);
			}
		} catch (error: any) {
			const errorDetails = {
				message: error.message,
				status: error.response?.status,
				statusText: error.response?.statusText,
				responseData: error.response?.data,
				code: error.code,
				stack: error.stack,
				url: error.config?.url,
				fullUrl: error.config?.baseURL ? `${error.config.baseURL}${error.config.url}` : error.config?.url
			};
			
			const errorMessage = error.response?.data?.message || error.message || 'Token refresh failed';
			console.error('[ZimaOS Token Refresh] Failed with error:', {
				timestamp: new Date().toISOString(),
				errorMessage,
				...errorDetails
			});
			
			this.log('error', 'Token refresh failed', errorDetails);
			this.showErrorNotice(errorMessage);
			return false;
		}
	}

	// Save authentication info to local storage
	private saveAuth(): void {
		try {
			localStorage.setItem('ozsync_auth', JSON.stringify(this.authState));
		} catch (error) {
			this.log('error', 'Failed to save authentication info', error);
		}
	}

	// Load authentication info from local storage
	private loadStoredAuth(): void {
		try {
			const stored = localStorage.getItem('ozsync_auth');
			if (stored) {
				const authData = JSON.parse(stored) as AuthState;
				// 检查token是否过期
				if (authData.tokenData && authData.tokenData.expires_at > Date.now() / 1000) {
					this.authState = authData;
					console.log('OZSync Auth: Valid token loaded from storage');
				} else {
					// Token过期，但不自动刷新，避免插件启动时的API请求
					// 刷新将在用户主动操作时进行
					if (authData.tokenData?.refresh_token) {
						this.authState = authData;
						console.log('OZSync Auth: Expired token found, will refresh when needed');
					} else {
						console.log('OZSync Auth: No valid token or refresh token found');
					}
				}
			}
		} catch (error) {
			this.log('error', 'Failed to load authentication info', error);
		}
	}

	// 清除认证信息
	private clearAuth(): void {
		this.authState = { isAuthenticated: false };
		localStorage.removeItem('ozsync_auth');
	}

	// 获取认证状态
	getAuthState(): AuthState {
		return { ...this.authState };
	}

	// 检查token是否需要刷新（即将过期或已过期）
	private async checkAndRefreshToken(): Promise<boolean> {
		if (!this.authState.tokenData?.access_token || !this.authState.tokenData?.refresh_token) {
			return false;
		}

		// 检查token是否即将过期（提前5分钟刷新）
		const currentTime = Date.now() / 1000;
		const expiresAt = this.authState.tokenData.expires_at;
		const bufferTime = 5 * 60; // 5分钟缓冲时间

		if (expiresAt <= currentTime + bufferTime) {
			console.log('[OZSync Token Check] Token is expiring soon, attempting refresh');
			return await this.refreshToken();
		}

		return true;
	}

	// 确保token有效的包装方法
	async ensureValidToken(): Promise<boolean> {
		// 如果没有认证状态，尝试自动登录
		if (!this.authState.isAuthenticated) {
			console.log('[OZSync Auth] Not authenticated, attempting auto-login');
			const loginSuccess = await this.login();
			return loginSuccess;
		}

		// 检查并刷新token
		return await this.checkAndRefreshToken();
	}

	// 登出
	logout(): void {
		this.clearAuth();
		this.log('info', 'Logged out successfully');
	}

	private initializeHttpClient(): void {
		const baseURL = `${this.settings.useHttps ? 'https' : 'http'}://${this.settings.serverUrl}:${this.settings.port}`;
		this.log('info', 'Initializing HTTP client', { baseURL, serverUrl: this.settings.serverUrl, port: this.settings.port });
		
		this.httpClient = axios.create({
			baseURL,
			timeout: 30000,
			headers: {
				// 移除默认的Content-Type，让axios根据数据类型自动设置
				// 对于FormData会自动设置multipart/form-data
				// 对于JSON会自动设置application/json
				'Accept': 'application/json, text/plain, */*'
			}
		});
		
		// 添加请求拦截器自动添加token
		this.httpClient.interceptors.request.use(
			(config) => {
				// 排除登录和刷新token的请求
				const isLoginRequest = config.url?.includes('/users/login');
				const isRefreshRequest = config.url?.includes('/users/refresh');
				
				if (!isLoginRequest && !isRefreshRequest && this.authState.isAuthenticated && this.authState.tokenData?.access_token) {
					config.headers.Authorization = this.authState.tokenData.access_token;
					this.log('info', 'Adding auth token to request', { 
						url: config.url, 
						method: config.method,
						hasToken: !!this.authState.tokenData.access_token,
						tokenPrefix: this.authState.tokenData.access_token?.substring(0, 10) + '...' 
					});
				} else if (!isLoginRequest && !isRefreshRequest) {
					this.log('warning', 'No auth token available for request', { 
						url: config.url, 
						method: config.method,
						isAuthenticated: this.authState.isAuthenticated,
						hasToken: !!this.authState.tokenData?.access_token
					});
				}
				return config;
			},
			(error) => {
				this.log('error', 'Request interceptor error', { error: error.message });
				return Promise.reject(error);
			}
		);
		
		// 添加响应拦截器处理token过期
		this.httpClient.interceptors.response.use(
			(response) => {
				this.log('info', 'HTTP response received', { 
					url: response.config.url, 
					status: response.status, 
					statusText: response.statusText 
				});
				return response;
			},
			async (error) => {
				const originalRequest = error.config;
				
				// 详细的错误信息收集
				const errorDetails = {
					method: originalRequest?.method?.toUpperCase(),
					url: originalRequest?.url,
					fullUrl: originalRequest?.baseURL ? `${originalRequest.baseURL}${originalRequest.url}` : originalRequest?.url,
					status: error.response?.status,
					statusText: error.response?.statusText,
					message: error.message,
					code: error.code,
					responseData: error.response?.data,
					requestHeaders: originalRequest?.headers,
					responseHeaders: error.response?.headers,
					timeout: originalRequest?.timeout,
					stack: error.stack
				};
				
				// 输出详细错误到控制台
				console.error('[OZSync HTTP Error] Detailed error information:', {
					timestamp: new Date().toISOString(),
					...errorDetails
				});
				
				this.log('error', `HTTP ${errorDetails.method} request failed`, errorDetails);
				
				if (error.response?.status === 401 && this.authState.tokenData?.refresh_token && !originalRequest._retry) {
					originalRequest._retry = true;
					this.log('info', 'Attempting token refresh due to 401 error', {
						url: originalRequest?.url,
						method: originalRequest?.method,
						hasRefreshToken: !!this.authState.tokenData?.refresh_token
					});
					try {
						const refreshed = await this.refreshToken();
						if (refreshed && this.authState.tokenData?.access_token) {
							// 更新请求头中的token
							originalRequest.headers.Authorization = this.authState.tokenData.access_token;
							this.log('info', 'Retrying request with refreshed token', {
								url: originalRequest?.url,
								newTokenPrefix: this.authState.tokenData.access_token?.substring(0, 10) + '...'
							});
							// 重新发送原始请求
							return this.httpClient.request(originalRequest);
						} else {
							this.log('error', 'Token refresh failed, clearing auth and rejecting request');
							this.clearAuth();
						}
					} catch (refreshError: any) {
						const refreshErrorDetails = {
							message: refreshError.message,
							status: refreshError.response?.status,
							statusText: refreshError.response?.statusText,
							responseData: refreshError.response?.data,
							stack: refreshError.stack
						};
						console.error('[ZimaOS Token Refresh Error] Detailed error:', refreshErrorDetails);
						this.log('error', 'Token refresh error', refreshErrorDetails);
						this.clearAuth();
						// 不要抛出refreshError，而是继续处理原始的401错误
					}
				}
				return Promise.reject(error);
			}
		);
	}

	/**
	 * Test connection to OZSync server
	 */
	async testConnection(): Promise<boolean> {
		console.log('[OZSync Client] 开始连接测试', {
			timestamp: new Date().toISOString(),
			serverUrl: this.settings.serverUrl,
			port: this.settings.port,
			useHttps: this.settings.useHttps,
			currentAuthState: {
				isAuthenticated: this.authState.isAuthenticated,
				hasToken: !!this.authState.tokenData?.access_token,
				hasRefreshToken: !!this.authState.tokenData?.refresh_token
			}
		});
		
		try {
			this.log('info', 'Starting connection test');
			
			// 首先尝试登录
			console.log('[OZSync Client] 尝试登录进行连接测试');
			this.log('info', 'Attempting login for connection test');
			const loginSuccess = await this.login();
			if (!loginSuccess) {
				console.error('[OZSync Client] 连接测试期间登录失败');
				this.log('error', 'Login failed during connection test');
				return false;
			}
			console.log('[OZSync Client] 登录成功，测试目录列表功能');
			this.log('info', 'Login successful, testing directory listing');
			
			// 测试新API连接 - 尝试列出根目录
			try {
				console.log('[OZSync Client] 调用listDirectories API测试连接');
				const result = await this.listDirectories('/');
				console.log('[OZSync Client] API连接测试成功', {
					directoriesCount: result.length,
					directories: result.map(d => ({ name: d.name, path: d.path, isDirectory: d.isDirectory }))
				});
				this.log('info', 'Connection test successful', { directoriesCount: result.length });
			} catch (apiError) {
				console.error('[OZSync Client] OZSync API连接失败', {
					error: apiError,
					message: (apiError as any)?.message,
					status: (apiError as any)?.response?.status,
					statusText: (apiError as any)?.response?.statusText,
					responseData: (apiError as any)?.response?.data
				});
				this.log('error', 'OZSync API connection failed', apiError);
				this.showErrorNotice('OZSync API connection failed');
				return false;
			}
			
			console.log('[OZSync Client] OZSync连接测试完全成功');
			this.log('info', 'OZSync connection test successful');
			return true;
		} catch (error: any) {
			const errorMessage = error.message || 'Connection test failed';
			console.error('[OZSync Client] 连接测试失败', {
				error: error.message,
				stack: error.stack,
				fullError: error
			});
			this.log('error', 'Connection test failed', { error: error.message, stack: error.stack });
			this.showErrorNotice(errorMessage);
			return false;
		}
	}



	/**
	 * List directories using new OZSync API
	 */
	async listDirectories(path: string = '/'): Promise<OZSyncDirectory[]> {
		try {
			// 确保token有效
			const tokenValid = await this.ensureValidToken();
			if (!tokenValid) {
				throw new Error('Authentication required');
			}

			const requestUrl = `/v2_1/files/folder`;
			const params = { 
				path: path, 
				index: '0', 
				sfz: 'true', 
				sort: 'name', 
				direction: 'asc' 
			};
			
			this.log('info', 'Listing directories', { 
				requestUrl, 
				params, 
				fullUrl: `${this.httpClient.defaults.baseURL}${requestUrl}` 
			});
			
			const response = await this.httpClient.get(requestUrl, { params });
			
			this.log('info', 'Directory listing response received', { 
				status: response.status, 
				dataExists: !!response.data, 
				contentExists: !!(response.data && response.data.content),
				itemCount: response.data?.content?.length || 0
			});

			if (response.data && response.data.content) {
				const directories = response.data.content.map((item: any) => ({
					name: item.name,
					path: item.path,
					isDirectory: item.is_dir,
					size: item.size || 0,
					modified: item.modified || new Date().toISOString()
				}));
				
				this.log('info', 'Successfully mapped directories', { count: directories.length });
				return directories;
			}

			this.log('warning', 'No data in response', { responseData: response.data });
			return [];
		} catch (error: any) {
			this.log('error', 'Failed to list directories', { 
				path, 
				error: error.message, 
				status: error.response?.status,
				statusText: error.response?.statusText,
				responseData: error.response?.data
			});
			throw error;
		}
	}

	/**
	 * List files in a directory using new OZSync API
	 */
	async listFiles(path: string = '/'): Promise<OZSyncFile[]> {
		try {
			// 确保token有效
			const tokenValid = await this.ensureValidToken();
			if (!tokenValid) {
				throw new Error('Authentication required');
			}

			const requestUrl = `/v2_1/files/file`;
			const params = { 
				path: path, 
				index: '0', 
				sfz: 'true', 
				sort: 'name', 
				direction: 'asc' 
			};
			
			this.log('info', 'Listing files', { 
				requestUrl, 
				params, 
				fullUrl: `${this.httpClient.defaults.baseURL}${requestUrl}` 
			});
			
			const response = await this.httpClient.get(requestUrl, { params });
			
			this.log('info', 'File listing response received', { 
				status: response.status, 
				dataExists: !!response.data, 
				contentExists: !!(response.data && response.data.content),
				itemCount: response.data?.content?.length || 0
			});

			if (response.data && response.data.content) {
				const files = response.data.content.map((item: any) => ({
					name: item.name,
					path: item.path,
					isDirectory: item.is_dir || false,
					size: item.size || 0,
					modified: item.modified || new Date().toISOString(),
					lastModified: item.modified ? new Date(item.modified).getTime() : Date.now()
				}));
				
				this.log('info', 'Successfully mapped files', { count: files.length });
				return files;
			}

			this.log('warning', 'No data in response', { responseData: response.data });
			return [];
		} catch (error: any) {
			this.log('error', 'Failed to list files', { 
				path, 
				error: error.message, 
				status: error.response?.status,
				statusText: error.response?.statusText,
				responseData: error.response?.data
			});
			throw error;
		}
	}

	/**
	 * Recursively get all files in a directory and its subdirectories
	 */
	async getAllFilesRecursive(path: string = '/'): Promise<OZSyncFile[]> {
		try {
			const allFiles: OZSyncFile[] = [];
			
			// Get files in current directory
			const files = await this.listFiles(path);
			allFiles.push(...files);
			
			// Get subdirectories
			const directories = await this.listDirectories(path);
			
			// Recursively get files from subdirectories
			for (const dir of directories) {
				const subFiles = await this.getAllFilesRecursive(dir.path);
				allFiles.push(...subFiles);
			}
			
			return allFiles;
		} catch (error: any) {
			this.log('error', 'Failed to get all files recursively', { 
				path, 
				error: error.message 
			});
			throw error;
		}
	}

	// File status query API - 文件状态查询接口
	async getFileStatsV2(filePaths: string[], showNotice: boolean = true): Promise<any[]> {
		try {
			// 确保token有效
			const tokenValid = await this.ensureValidToken();
			if (!tokenValid) {
				throw new Error('Authentication required');
			}

			const requestUrl = '/v2_1/files/mediainfo';
			console.log('[OZSync File Stats] Requesting file stats:', {
				url: requestUrl,
				fullUrl: `${this.httpClient.defaults.baseURL}${requestUrl}`,
				filePaths,
				fileCount: filePaths.length
			});
			
			const response = await this.httpClient.post(requestUrl, filePaths);
			
			console.log('[ZimaOS File Stats] Response received:', {
				status: response.status,
				statusText: response.statusText,
				hasData: !!response.data,
				dataLength: Array.isArray(response.data) ? response.data.length : 'not array'
			});
			
			if (response.data) {
				return response.data;
			}
			return [];
		} catch (error: any) {
			const errorDetails = {
				methodName: 'getFileStatsV2',
				filePaths,
				fileCount: filePaths.length,
				message: error.message,
				status: error.response?.status,
				statusText: error.response?.statusText,
				responseData: error.response?.data,
				code: error.code,
				stack: error.stack,
				url: error.config?.url,
				fullUrl: error.config?.baseURL ? `${error.config.baseURL}${error.config.url}` : error.config?.url
			};
			
			// 对于文件不存在的情况（404或500状态码），静默处理，不报错
			if (error.response?.status === 404 || error.response?.status === 500) {
				console.log('[OZSync File Stats] File not found (status: ' + error.response?.status + '), returning empty array');
				return [];
			}
			
			console.error('[OZSync File Stats] Failed to get file stats:', {
				timestamp: new Date().toISOString(),
				...errorDetails
			});
			
			this.log('error', 'Failed to get file stats', errorDetails);
			
			if (showNotice) {
				const errorMessage = error.response?.data?.message || error.message || 'Failed to get file stats';
				this.showErrorNotice(errorMessage);
			}
			throw error;
		}
	}

	// File existence check using file stats API - 基于文件状态查询接口实现文件存在性检查
	async fileExistsV2(filePath: string): Promise<boolean> {
		try {
			const stats = await this.getFileStatsV2([filePath], false);
			return stats && stats.length > 0 && stats[0] !== null;
		} catch (error) {
			// If API call fails, assume file doesn't exist
			return false;
		}
	}



	// Upload file API - 文件上传接口
	async uploadFile(filePath: string, content: ArrayBuffer, showNotice: boolean = true): Promise<boolean> {
		try {
			// 确保token有效
			const tokenValid = await this.ensureValidToken();
			if (!tokenValid) {
				throw new Error('Authentication required');
			}

			const requestUrl = '/v2_1/files/upload';
			const formData = new FormData();
			const blob = new Blob([content]);
			formData.append('files', blob, filePath);
			formData.append('path', filePath);

			console.log('[ZimaOS Upload File] Uploading file:', {
				url: requestUrl,
				fullUrl: `${this.httpClient.defaults.baseURL}${requestUrl}`,
				filePath,
				contentSize: content.byteLength,
				blobSize: blob.size,
				formDataEntries: 'FormData with files and path'
			});

			const response = await this.httpClient.post(requestUrl, formData, {
				headers: {
					'Content-Type': 'multipart/form-data',
				},
			});

			console.log('[ZimaOS Upload File] Response received:', {
				status: response.status,
				statusText: response.statusText,
				responseData: response.data,
				filePath
			});

			return response.status === 200;
		} catch (error: any) {
			const errorDetails = {
				methodName: 'uploadFile',
				filePath,
				contentSize: content.byteLength,
				message: error.message,
				status: error.response?.status,
				statusText: error.response?.statusText,
				responseData: error.response?.data,
				code: error.code,
				stack: error.stack,
				url: error.config?.url,
				fullUrl: error.config?.baseURL ? `${error.config.baseURL}${error.config.url}` : error.config?.url
			};
			
			console.error('[OZSync Upload File] Failed to upload file:', {
				timestamp: new Date().toISOString(),
				...errorDetails
			});
			
			this.log('error', 'Failed to upload file', errorDetails);
			
			if (showNotice) {
				const errorMessage = error.response?.data?.message || error.message || 'Failed to upload file';
				this.showErrorNotice(`Failed to upload file ${filePath}: ${errorMessage}`);
			}
			return false;
		}
	}

	/**
	 * Upload a file using new OZSync API
	 */
	async uploadFileV2(targetPath: string, fileName: string, content: string | Buffer): Promise<boolean> {
		try {
			// 确保token有效
			const tokenValid = await this.ensureValidToken();
			if (!tokenValid) {
				throw new Error('Authentication required');
			}

			const formData = new FormData();
			
			// 检测文件类型并设置正确的MIME类型
			let mimeType = 'application/octet-stream';
			const fileExtension = fileName.toLowerCase().split('.').pop();
			
			switch (fileExtension) {
				case 'txt':
				case 'md':
					mimeType = 'text/plain';
					break;
				case 'json':
					mimeType = 'application/json';
					break;
				case 'html':
					mimeType = 'text/html';
					break;
				case 'css':
					mimeType = 'text/css';
					break;
				case 'js':
					mimeType = 'application/javascript';
					break;
				case 'png':
					mimeType = 'image/png';
					break;
				case 'jpg':
				case 'jpeg':
					mimeType = 'image/jpeg';
					break;
				case 'gif':
					mimeType = 'image/gif';
					break;
				case 'svg':
					mimeType = 'image/svg+xml';
					break;
				case 'pdf':
					mimeType = 'application/pdf';
					break;
				case 'canvas':
					mimeType = 'application/json'; // Obsidian canvas files are JSON
					break;
				case 'yaml':
				case 'yml':
					mimeType = 'application/x-yaml';
					break;
				default:
					mimeType = 'application/octet-stream';
			}
			
			// 检查文件内容是否为空
			const contentSize = typeof content === 'string' ? content.length : content.byteLength || 0;
			if (contentSize === 0) {
				console.warn('[ZimaOS Upload V2] Warning: File content is empty:', {
					targetPath,
					fileName,
					contentType: typeof content,
					contentSize
				});
			}
			
			console.log('[ZimaOS Upload V2] Preparing upload:', {
				targetPath,
				fileName,
				fileExtension,
				mimeType,
				contentSize,
				contentType: typeof content
			});
			
			// Create a blob from content with correct MIME type
			const blob = new Blob([content], { type: mimeType });
			
			// 使用正确的FormData格式 - 根据用户提供的curl命令
			formData.append('path', targetPath);
			formData.append('file', blob, fileName); // 使用'file'字段而不是'files'

			console.log('[ZimaOS Upload V2] FormData prepared:', {
				path: targetPath,
				fileName,
				blobSize: blob.size,
				blobType: blob.type,
				isEmptyFile: blob.size === 0
			});
			
			// 如果文件为空，添加警告但继续上传
			if (blob.size === 0) {
				console.warn('[ZimaOS Upload V2] Uploading empty file - this may cause "invalid media type" error');
			}

			// 使用正确的API端点 - 根据用户提供的curl命令
			const requestUrl = '/v2_1/files/file/uploadV2';
			
			// 确保FormData正确发送，不设置Content-Type让浏览器自动处理
			const response = await this.httpClient.post(requestUrl, formData, {
				headers: {
					// 明确移除Content-Type，让浏览器自动设置multipart/form-data
					// 这样可以避免发送application/json导致的"invalid media type"错误
				},
				// 确保axios正确处理FormData
				transformRequest: [(data) => {
					// 如果是FormData，直接返回，不进行JSON序列化
					if (data instanceof FormData) {
						console.log('[OZSync Upload V2] Sending FormData directly');
						return data;
					}
					return data;
				}]
			});

			console.log('[ZimaOS Upload V2] Response received:', {
				status: response.status,
				statusText: response.statusText,
				responseData: response.data,
				filePath: `${targetPath}/${fileName}`
			});

			if (response.status === 200) {
				this.log('info', `File uploaded successfully: ${targetPath}/${fileName}`);
				return true;
			} else {
				const errorMessage = response.data?.message || 'Upload failed';
				this.log('error', errorMessage);
				this.showErrorNotice(errorMessage);
				return false;
			}
		} catch (error: any) {
			const errorDetails = {
				methodName: 'uploadFileV2',
				targetPath,
				fileName,
				message: error.message,
				status: error.response?.status,
				statusText: error.response?.statusText,
				responseData: error.response?.data,
				code: error.code,
				stack: error.stack,
				url: error.config?.url,
				fullUrl: error.config?.baseURL ? `${error.config.baseURL}${error.config.url}` : error.config?.url
			};
			
			console.error('[ZimaOS Upload V2] Failed to upload file:', {
				timestamp: new Date().toISOString(),
				...errorDetails
			});
			
			const errorMessage = error.response?.data?.message || error.message || 'Upload failed';
			this.log('error', `Failed to upload file: ${targetPath}/${fileName}`, errorDetails);
			this.showErrorNotice(errorMessage);
			return false;
		}
	}







	/**
	 * Download a file from ZimaOS using new API.
	 * Always downloads as ArrayBuffer to preserve binary data.
	 * Returns null on failure.
	 */
	async downloadFile(remotePath: string): Promise<ArrayBuffer | null> {
		try {
			const tokenValid = await this.ensureValidToken();
			if (!tokenValid) {
				throw new Error('Authentication required');
			}

			const encodedPath = encodeURIComponent(remotePath);
			const response = await this.httpClient.get(`/v2_1/files/file/download?path=${encodedPath}`, {
				responseType: 'arraybuffer'
			});

			if (response.status === 200) {
				this.log('info', `File downloaded successfully: ${remotePath}`);
				return response.data;
			} else {
				this.log('error', `Failed to download file: ${remotePath}`);
				return null;
			}
		} catch (error: any) {
			const errorMessage = error.response?.data?.message || error.message || 'Failed to download file';
			this.log('error', `Failed to download file: ${remotePath}`, error);
			return null;
		}
	}

	/**
	 * Delete a file from OZSync using new API v2
	 */
	async deleteFileV2(remotePath: string): Promise<boolean> {
		try {
			// 确保token有效
			const tokenValid = await this.ensureValidToken();
			if (!tokenValid) {
				throw new Error('Authentication required');
			}

			// Use array format as required by the API
			// Authorization header will be added automatically by request interceptor
			const response = await this.httpClient.delete('/v2_1/files/file', {
				data: [remotePath],
				headers: {
					'Content-Type': 'application/json'
				}
			});

			if (response.status === 200) {
				this.log('info', `File deleted successfully: ${remotePath}`);
				return true;
			} else {
				const errorMessage = response.data?.message || 'Failed to delete file';
				this.log('error', errorMessage);
				this.showErrorNotice(errorMessage);
				return false;
			}
		} catch (error: any) {
			const errorMessage = error.response?.data?.message || error.message || 'Failed to delete file';
			this.log('error', `Failed to delete file: ${remotePath}`, error);
			this.showErrorNotice(errorMessage);
			return false;
		}
	}

	/**
	 * Delete a file from OZSync using new API (alias for backward compatibility)
	 */
	async deleteFile(remotePath: string): Promise<boolean> {
		return this.deleteFileV2(remotePath);
	}

	// Create directory API - 创建目录接口
	async createDirectory(path: string, showNotice: boolean = true): Promise<boolean> {
		try {
			// 确保token有效
			const tokenValid = await this.ensureValidToken();
			if (!tokenValid) {
				throw new Error('Authentication required');
			}

			const requestUrl = '/v2_1/files/folder';
			const requestData = { path: path };
			
			console.log('[OZSync Create Directory] Creating directory:', {
				url: requestUrl,
				fullUrl: `${this.httpClient.defaults.baseURL}${requestUrl}`,
				path,
				requestData
			});
			
			const response = await this.httpClient.post(requestUrl, requestData, {
				headers: {
					'Content-Type': 'application/json'
				}
			});
			
			console.log('[OZSync Create Directory] Response received:', {
				status: response.status,
				statusText: response.statusText,
				responseData: response.data,
				path
			});
			
			return response.status === 200;
		} catch (error: any) {
			const errorDetails = {
				methodName: 'createDirectory',
				path,
				message: error.message,
				status: error.response?.status,
				statusText: error.response?.statusText,
				responseData: error.response?.data,
				code: error.code,
				stack: error.stack,
				url: error.config?.url,
				fullUrl: error.config?.baseURL ? `${error.config.baseURL}${error.config.url}` : error.config?.url
			};
			
			console.error('[OZSync Create Directory] Failed to create directory:', {
				timestamp: new Date().toISOString(),
				...errorDetails
			});
			
			this.log('error', 'Failed to create directory', errorDetails);
			
			if (showNotice) {
				const errorMessage = error.response?.data?.message || error.message || 'Failed to create directory';
				this.showErrorNotice(`Failed to create directory: ${errorMessage}`);
			}
			return false;
		}
	}



	/**
	 * Show error notice with red styling
	 */
	private showErrorNotice(message: string): void {
		const notice = new Notice(`❌ ${message}`, 5000);
		// Add red styling to the notice
		if (notice.noticeEl) {
			notice.noticeEl.style.backgroundColor = '#ff4444';
			notice.noticeEl.style.color = 'white';
			notice.noticeEl.style.borderLeft = '4px solid #cc0000';
		}
	}

	/**
	 * Log messages with timestamp
	 */
	private log(level: 'info' | 'warning' | 'error', message: string, details?: any): void {
		const logEntry: SyncLog = {
			timestamp: new Date(),
			level,
			message,
			details
		};
		
		this.logs.push(logEntry);

		// Keep only last 1000 log entries
		if (this.logs.length > 1000) {
			this.logs = this.logs.slice(-1000);
		}

		// Log to console — Notices are created by callers via showErrorNotice()
		console.log(`[OZSync] ${level.toUpperCase()}: ${message}`, details);
	}

	/**
	 * Get recent logs
	 */
	getLogs(limit: number = 100): SyncLog[] {
		return this.logs.slice(-limit);
	}

	/**
	 * Clear logs
	 */
	clearLogs(): void {
		this.logs = [];
	}

	/**
	 * Update connection configuration
	 */
	updateSettings(settings: OZSyncSettings): void {
		this.settings = settings;
		
		// Update HTTP client base URL
		const baseURL = `${settings.useHttps ? 'https' : 'http'}://${settings.serverUrl}:${settings.port}`;
		this.httpClient.defaults.baseURL = baseURL;
		this.httpClient.defaults.timeout = 30000;
	}
}