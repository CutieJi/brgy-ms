/**
 * MISLend Core Application Client
 * Backend: Node.js + Express
 * Database: Supabase SQL (with local storage fallback)
 * 100% design and interface compatibility layer
 */

(function (window) {
    'use strict';

    window.DEFAULT_PROFILE_IMAGE = 'assets/images/default-profile.png';

    // -------------------------------------------------------------------------
    // Backend API Base URL Configuration
    // -------------------------------------------------------------------------
    const API_BASE = (() => {
        const configuredBase = window.MISLEND_API_BASE || window.__MISLEND_API_BASE__;
        if (configuredBase) return String(configuredBase).replace(/\/+$/, '');

        const { protocol, hostname, port } = window.location;
        const isHttpLike = protocol === 'http:' || protocol === 'https:';

        if (!isHttpLike) {
            return 'http://localhost:3000/api';
        }

        if (port === '3000') {
            return '/api';
        }

        if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(hostname)) {
            return 'http://localhost:3000/api';
        }

        return '/api';
    })();

    const TOKEN_KEY = 'mislend_token';
    const USER_KEY = 'mislend_user';

    // -------------------------------------------------------------------------
    // Helper: Wrap Timestamps to support .toDate()
    // -------------------------------------------------------------------------
    function wrapDocData(data) {
        if (!data || typeof data !== 'object') return data;
        const result = Array.isArray(data) ? [] : {};

        for (const [key, val] of Object.entries(data)) {
            if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val)) {
                const d = new Date(val);
                result[key] = {
                    toDate: () => d,
                    toMillis: () => d.getTime(),
                    toISOString: () => val,
                    toString: () => d.toString()
                };
            } else if (val && typeof val === 'object' && val.__type === 'serverTimestamp') {
                const d = new Date(val.value || Date.now());
                result[key] = {
                    toDate: () => d,
                    toMillis: () => d.getTime(),
                    toISOString: () => d.toISOString(),
                    toString: () => d.toString()
                };
            } else if (val && typeof val === 'object' && !val.toDate) {
                result[key] = wrapDocData(val);
            } else {
                result[key] = val;
            }
        }
        return result;
    }

    function unwrapData(data) {
        if (!data || typeof data !== 'object') return data;
        const result = Array.isArray(data) ? [] : {};

        for (const [key, val] of Object.entries(data)) {
            if (val && typeof val === 'object') {
                if (typeof val.toDate === 'function') {
                    result[key] = val.toDate().toISOString();
                } else if (val.__type === 'serverTimestamp') {
                    result[key] = new Date().toISOString();
                } else if (val.__type === 'increment') {
                    result[key] = val.value;
                } else {
                    result[key] = unwrapData(val);
                }
            } else {
                result[key] = val;
            }
        }
        return result;
    }

    // -------------------------------------------------------------------------
    // HTTP API Request Helper
    // -------------------------------------------------------------------------
    async function apiRequest(endpoint, method = 'GET', body = null, tokenOverride = null) {
        const token = tokenOverride !== null ? tokenOverride : localStorage.getItem(TOKEN_KEY);
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const config = { method, headers };
        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
            config.body = JSON.stringify(body);
        }

        try {
            const res = await fetch(`${API_BASE}${endpoint}`, config);
            const json = await res.json().catch(() => ({}));
            if (!res.ok) {
                const err = new Error(json.error || `Request failed with status ${res.status}`);
                err.status = res.status;
                err.code = json.code || (res.status === 401 ? 'auth/unauthenticated' : (res.status === 403 ? 'permission-denied' : (res.status === 404 ? 'not-found' : 'request-failed')));
                throw err;
            }
            return json;
        } catch (err) {
            if (err.message && err.message.includes('Failed to fetch')) {
                console.error('[MISLend] Cannot connect to Node.js backend at', API_BASE);
                console.error('[MISLend] Ensure `node server/index.js` or `npm start` is running in the server directory.');
            }
            throw err;
        }
    }

    // -------------------------------------------------------------------------
    // DocumentSnapshot and QuerySnapshot
    // -------------------------------------------------------------------------
    class DocumentSnapshot {
        constructor(id, data, ref) {
            this.id = id;
            this._data = data;
            this.exists = !!data;
            this.ref = ref;
        }

        data() {
            return this._data ? wrapDocData({ ...this._data }) : undefined;
        }
    }

    class QuerySnapshot {
        constructor(docs, ref) {
            this.docs = docs;
            this.empty = docs.length === 0;
            this.size = docs.length;
            this.ref = ref;
        }

        forEach(callback) {
            this.docs.forEach(callback);
        }
    }

    // -------------------------------------------------------------------------
    // API document reference
    // -------------------------------------------------------------------------
    class DocumentReference {
        constructor(collectionName, id, parentDocId = null) {
            this.collectionName = collectionName;
            this.id = id;
            this.parentDocId = parentDocId;
        }

        async get() {
            try {
                let endpoint = `/data/${this.collectionName}/${this.id}`;
                if (this.parentDocId && this.collectionName === 'messages') {
                    // Fetch incident messages
                    const res = await apiRequest(`/data/incidents/${this.parentDocId}/messages`);
                    const found = (res.data || []).find(m => m.id === this.id);
                    return new DocumentSnapshot(this.id, found || null, this);
                }
                const res = await apiRequest(endpoint);
                return new DocumentSnapshot(this.id, res.data || null, this);
            } catch (err) {
                if (err.status === 404) {
                    return new DocumentSnapshot(this.id, null, this);
                }
                throw err;
            }
        }

        async set(data, options = {}) {
            const clean = unwrapData(data);
            const endpoint = `/data/${this.collectionName}/${this.id}`;
            await apiRequest(endpoint, 'PUT', clean);
            return this;
        }

        async update(data) {
            const clean = unwrapData(data);
            const endpoint = `/data/${this.collectionName}/${this.id}`;
            await apiRequest(endpoint, 'PATCH', clean);
            return this;
        }

        async delete() {
            const endpoint = `/data/${this.collectionName}/${this.id}`;
            await apiRequest(endpoint, 'DELETE');
            return true;
        }

        collection(subCollectionName) {
            return new CollectionReference(subCollectionName, this.id);
        }

        onSnapshot(onNext, onError) {
            let active = true;
            let lastHash = '';

            const fetchLatest = async () => {
                if (!active) return;
                try {
                    const snap = await this.get();
                    if (!active) return;
                    const serialized = JSON.stringify(snap.data() || {});
                    if (serialized !== lastHash) {
                        lastHash = serialized;
                        onNext(snap);
                    }
                } catch (e) {
                    if (onError) onError(e);
                    else console.error('onSnapshot doc error:', e);
                }
            };

            fetchLatest();
            const intervalId = setInterval(fetchLatest, 3000);

            return () => {
                active = false;
                clearInterval(intervalId);
            };
        }
    }

    // -------------------------------------------------------------------------
    // API query
    // -------------------------------------------------------------------------
    class Query {
        constructor(collectionName, filters = [], orderByField = null, orderDirection = 'asc', limitCount = null, parentDocId = null) {
            this.collectionName = collectionName;
            this.filters = [...filters];
            this.orderByField = orderByField;
            this.orderDirection = orderDirection;
            this.limitCount = limitCount;
            this.parentDocId = parentDocId;
        }

        where(field, op, val) {
            const mappedField = (field && typeof field === 'object' && field.__isDocId) ? 'id' : field;
            return new Query(
                this.collectionName,
                [...this.filters, [mappedField, op, val]],
                this.orderByField,
                this.orderDirection,
                this.limitCount,
                this.parentDocId
            );
        }

        orderBy(field, direction = 'asc') {
            return new Query(
                this.collectionName,
                this.filters,
                field,
                direction,
                this.limitCount,
                this.parentDocId
            );
        }

        limit(count) {
            return new Query(
                this.collectionName,
                this.filters,
                this.orderByField,
                this.orderDirection,
                count,
                this.parentDocId
            );
        }

        async get() {
            if (this.parentDocId && this.collectionName === 'messages') {
                const res = await apiRequest(`/data/incidents/${this.parentDocId}/messages`);
                let items = res.data || [];
                if (this.orderByField) {
                    items.sort((a, b) => {
                        const valA = a[this.orderByField];
                        const valB = b[this.orderByField];
                        return this.orderDirection === 'desc' ? (valA < valB ? 1 : -1) : (valA > valB ? 1 : -1);
                    });
                }
                const docs = items.map(item => new DocumentSnapshot(item.id, item, new DocumentReference('messages', item.id, this.parentDocId)));
                return new QuerySnapshot(docs, this);
            }

            const res = await apiRequest(`/data/${this.collectionName}/query`, 'POST', {
                filters: this.filters,
                orderBy: this.orderByField,
                orderDir: this.orderDirection,
                limit: this.limitCount
            });

            const items = res.data || [];
            const docs = items.map(item => new DocumentSnapshot(item.id, item, new DocumentReference(this.collectionName, item.id)));
            return new QuerySnapshot(docs, this);
        }

        onSnapshot(onNext, onError) {
            let active = true;
            let lastHash = '';

            const fetchLatest = async () => {
                if (!active) return;
                try {
                    const snap = await this.get();
                    if (!active) return;
                    const serialized = JSON.stringify(snap.docs.map(d => d.data()));
                    if (serialized !== lastHash) {
                        lastHash = serialized;
                        onNext(snap);
                    }
                } catch (e) {
                    if (onError) onError(e);
                    else console.error('onSnapshot query error:', e);
                }
            };

            fetchLatest();
            const intervalId = setInterval(fetchLatest, 3000);

            return () => {
                active = false;
                clearInterval(intervalId);
            };
        }
    }

    // -------------------------------------------------------------------------
    // API collection
    // -------------------------------------------------------------------------
    class CollectionReference extends Query {
        constructor(collectionName, parentDocId = null) {
            super(collectionName, [], null, 'asc', null, parentDocId);
        }

        doc(id = null) {
            const docId = id || `doc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
            return new DocumentReference(this.collectionName, docId, this.parentDocId);
        }

        async add(data) {
            const clean = unwrapData(data);
            if (this.parentDocId && this.collectionName === 'messages') {
                const res = await apiRequest(`/data/incidents/${this.parentDocId}/messages`, 'POST', clean);
                const saved = res.data;
                return new DocumentReference('messages', saved.id, this.parentDocId);
            }

            const res = await apiRequest(`/data/${this.collectionName}`, 'POST', clean);
            const saved = res.data;
            return new DocumentReference(this.collectionName, saved.id);
        }
    }

    // -------------------------------------------------------------------------
    // API write batch
    // -------------------------------------------------------------------------
    class WriteBatch {
        constructor() {
            this.operations = [];
        }

        set(docRef, data, options = {}) {
            this.operations.push({
                type: 'set',
                collection: docRef.collectionName,
                id: docRef.id,
                data: unwrapData(data)
            });
            return this;
        }

        update(docRef, data) {
            this.operations.push({
                type: 'update',
                collection: docRef.collectionName,
                id: docRef.id,
                data: unwrapData(data)
            });
            return this;
        }

        delete(docRef) {
            this.operations.push({
                type: 'delete',
                collection: docRef.collectionName,
                id: docRef.id
            });
            return this;
        }

        async commit() {
            if (this.operations.length === 0) return true;
            await apiRequest('/batch', 'POST', { operations: this.operations });
            return true;
        }
    }

    // -------------------------------------------------------------------------
    // Auth Client
    // -------------------------------------------------------------------------
    class AuthClient {
        constructor(isSecondary = false) {
            this.isSecondary = isSecondary;
            this._currentUser = null;
            this._listeners = [];

            if (!isSecondary) {
                this._initSession();
            }
        }

        _initSession() {
            try {
                const savedUser = localStorage.getItem(USER_KEY);
                if (savedUser) {
                    this._currentUser = this._createSessionUser(JSON.parse(savedUser));
                }
            } catch (e) {
                console.warn('Failed parsing stored user:', e);
            }
        }

        get currentUser() {
            return this._currentUser;
        }

        _createSessionUser(userData) {
            if (!userData) return null;
            const uid = userData.id || userData.uid;
            const userObj = {
                uid: uid,
                id: uid,
                email: userData.email || '',
                displayName: userData.name || `${userData.firstName || ''} ${userData.lastName || ''}`.trim(),
                photoURL: userData.photoURL || null,
                role: userData.role || 'resident',
                status: userData.status || 'approved',
                getIdToken: async () => localStorage.getItem(TOKEN_KEY) || '',
                updateProfile: async (profile) => {
                    const updates = {};
                    if (profile.displayName !== undefined) {
                        updates.name = profile.displayName;
                        userObj.displayName = profile.displayName;
                    }
                    if (profile.photoURL !== undefined) {
                        updates.photoURL = profile.photoURL;
                        userObj.photoURL = profile.photoURL;
                    }
                    await apiRequest(`/data/users/${uid}`, 'PATCH', updates);
                    localStorage.setItem(USER_KEY, JSON.stringify({ ...userData, ...updates }));
                },
                updatePassword: async (newPassword, currentPassword, otpCode) => {
                    return apiRequest('/auth/change-password', 'POST', { newPassword, currentPassword, otpCode });
                },
                reauthenticateWithCredential: async (cred) => {
                    return true;
                }
            };
            return userObj;
        }

        async sendPasswordOtp(email, purpose = 'change') {
            return apiRequest('/auth/send-password-otp', 'POST', {
                email: email || (this._currentUser && this._currentUser.email),
                purpose
            });
        }

        async confirmPasswordReset(email, otpCode, newPassword) {
            return apiRequest('/auth/reset-password', 'POST', { email, otpCode, newPassword });
        }

        onAuthStateChanged(callback) {
            this._listeners.push(callback);
            // Notify listeners asynchronously after registration.
            setTimeout(() => {
                callback(this._currentUser);
            }, 0);

            return () => {
                this._listeners = this._listeners.filter(cb => cb !== callback);
            };
        }

        _notifyListeners() {
            this._listeners.forEach(cb => {
                try {
                    cb(this._currentUser);
                } catch (e) {
                    console.error('Auth listener error:', e);
                }
            });
        }

        async signInWithEmailAndPassword(emailOrId, password) {
            const res = await apiRequest('/auth/login', 'POST', { emailOrId, password });
            if (!this.isSecondary) {
                localStorage.setItem(TOKEN_KEY, res.token);
                localStorage.setItem(USER_KEY, JSON.stringify(res.user));
                this._currentUser = this._createSessionUser(res.user);
                this._notifyListeners();
            }
            return { user: this._createSessionUser(res.user) };
        }

        async createUserWithEmailAndPassword(email, password, profile = {}, turnstileToken) {
            const res = await apiRequest('/auth/register', 'POST', { email, password, ...profile, turnstileToken });
            if (!this.isSecondary) {
                localStorage.setItem(TOKEN_KEY, res.token);
                localStorage.setItem(USER_KEY, JSON.stringify(res.user));
                this._currentUser = this._createSessionUser(res.user);
                this._notifyListeners();
            }
            return { user: this._createSessionUser(res.user) };
        }

        async getRegistrationTurnstileConfig() {
            return apiRequest('/auth/turnstile-config');
        }

        async createAdminManagedUser(profile) {
            return apiRequest('/auth/admin-create-user', 'POST', profile);
        }

        async sendOverdueReminder(borrowingId, type) {
            return apiRequest('/notifications/overdue-reminder', 'POST', { borrowingId, type });
        }

        async suspendAccount(userId, reason) {
            return apiRequest(`/admin/users/${encodeURIComponent(userId)}/suspend`, 'POST', { reason });
        }

        async approveAccount(userId) {
            return apiRequest(`/admin/users/${encodeURIComponent(userId)}/approve`, 'POST');
        }

        async signOut() {
            localStorage.removeItem(TOKEN_KEY);
            localStorage.removeItem(USER_KEY);
            this._currentUser = null;
            this._notifyListeners();
            return Promise.resolve();
        }

        async sendPasswordResetEmail(email) {
            return apiRequest('/auth/forgot-password-reset-link', 'POST', { email });
        }

        async sendAdminPasswordResetLink(uid) {
            return apiRequest('/auth/admin-send-password-reset-link', 'POST', { uid });
        }

        async setUserPassword(uid, password) {
            return apiRequest('/auth/admin-set-password', 'POST', { uid, password });
        }

        async verifyPasswordResetToken(token) {
            return apiRequest(`/auth/password-reset-link/${encodeURIComponent(token)}`);
        }

        async confirmPasswordResetLink(token, newPassword) {
            return apiRequest('/auth/password-reset-link', 'POST', { token, newPassword });
        }

    }

    // -------------------------------------------------------------------------
    // Shared API clients
    // -------------------------------------------------------------------------
    const mainAuth = new AuthClient(false);
    const secondaryAuth = new AuthClient(true);

    const dbInstance = {
        collection: (name) => new CollectionReference(name),
        batch: () => new WriteBatch(),
        FieldValue: {
            serverTimestamp: () => ({ __type: 'serverTimestamp' }),
            delete: () => '__DELETE__',
            increment: (n) => ({ __type: 'increment', value: n })
        },
        FieldPath: {
            documentId: () => ({ __isDocId: true })
        }
    };

    window.auth = mainAuth;
    window.db = dbInstance;
    window.watchUserProfile = (userId, onUpdate) => {
        if (!userId || typeof onUpdate !== 'function') {
            throw new Error('A user ID and profile update callback are required.');
        }

        return dbInstance.collection('users').doc(userId).onSnapshot(snapshot => {
            const userData = snapshot.data();
            if (userData) onUpdate(userData);
        }, error => {
            console.error('Unable to watch user profile updates:', error);
        });
    };
    window.startViewAutoRefresh = (getActiveView, refreshers, intervalMs = 5000) => {
        if (typeof getActiveView !== 'function' || !refreshers || typeof refreshers !== 'object') {
            throw new Error('An active-view getter and view refresh handlers are required.');
        }

        let refreshing = false;
        let active = true;
        const refresh = async () => {
            if (!active || refreshing || document.hidden ||
                document.querySelector('.modal.active, .mislend-cropper-overlay.active')) {
                return;
            }

            const view = getActiveView();
            const refreshView = refreshers[view];
            if (typeof refreshView !== 'function') return;

            refreshing = true;
            try {
                await refreshView();
            } catch (error) {
                console.error(`Unable to automatically refresh the ${view} view:`, error);
            } finally {
                refreshing = false;
            }
        };

        const onVisibilityChange = () => {
            if (!document.hidden) refresh();
        };
        const intervalId = setInterval(refresh, intervalMs);
        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('focus', refresh);

        const stop = () => {
            active = false;
            clearInterval(intervalId);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('focus', refresh);
            window.removeEventListener('pagehide', stop);
        };
        window.addEventListener('pagehide', stop, { once: true });
        return stop;
    };

    // -------------------------------------------------------------------------
    // UI Helpers (Preserved 100% from original design)
    // -------------------------------------------------------------------------
    function resizeImage(file, maxWidth = 200, maxHeight = 200) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxWidth) {
                            height *= maxWidth / width;
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width *= maxHeight / height;
                            height = maxHeight;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                };
                img.onerror = reject;
            };
            reader.onerror = reject;
        });
    }

    function getSecondaryAuth() {
        return secondaryAuth;
    }

    function showToast(message, type = 'success') {
        console.log(`[TOAST] ${type.toUpperCase()}: ${message}`);
        const toast = document.getElementById('toast');
        if (!toast) return;

        toast.innerHTML = `<span>${message}</span>`;
        toast.className = `toast show ${type}`;

        setTimeout(() => {
            toast.classList.remove('show');
        }, type === 'warning' ? 8000 : 3000);
    }

    function showConfirm(options = {}) {
        const {
            title = 'Are you sure?',
            message = 'Do you want to proceed with this action?',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            type = 'danger',
            inputLabel = '',
            inputPlaceholder = '',
            selectLabel = '',
            selectOptions = [],
            selectPlaceholder = 'Select an option',
            selectDefault = '',
            selectHelpText = ''
        } = options;

        return new Promise((resolve) => {
            let modal = document.getElementById('confirmModal');

            if (!modal) {
                modal = document.createElement('div');
                modal.id = 'confirmModal';
                modal.className = 'modal';
                modal.innerHTML = `
                    <div class="modal-content" style="max-width: 400px; text-align: center;">
                        <div class="modal-header" style="justify-content: center; margin-bottom: 20px;">
                            <h2 id="confirmTitle" style="font-size: 1.3rem;"></h2>
                        </div>
                        <p id="confirmMessage" style="color: var(--text-secondary); margin-bottom: 16px; line-height: 1.5;"></p>
                        <div id="confirmInputWrap" style="display: none; margin-bottom: 20px; text-align: left;">
                            <label id="confirmInputLabel" style="display: block; font-size: 0.85rem; font-weight: 600; margin-bottom: 6px; color: var(--text-primary);"></label>
                            <input type="text" id="confirmInput" style="width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-md, 8px); font-size: 0.9rem; background: var(--bg-secondary, #f8fafc); color: var(--text-primary); outline: none; transition: border-color 0.2s;" />
                            <select id="confirmSelect" style="display: none; width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--radius-md, 8px); font-size: 0.9rem; background: var(--bg-secondary, #f8fafc); color: var(--text-primary); outline: none;"></select>
                            <p id="confirmSelectHelp" style="display: none; font-size: 0.78rem; color: var(--text-secondary); margin-top: 6px;"></p>
                            <p id="confirmInputError" style="display: none; font-size: 0.78rem; color: var(--danger, #ef4444); margin-top: 4px;"></p>
                        </div>
                        <div class="modal-actions" style="justify-content: center; gap: 12px;">
                            <button id="confirmCancel" class="btn btn-secondary" style="flex: 1;"></button>
                            <button id="confirmBtn" class="btn" style="flex: 1;"></button>
                        </div>
                    </div>
                `;
                document.body.appendChild(modal);
            }

            const titleEl = modal.querySelector('#confirmTitle');
            const messageEl = modal.querySelector('#confirmMessage');
            const cancelBtn = modal.querySelector('#confirmCancel');
            const confirmBtn = modal.querySelector('#confirmBtn');
            const inputWrap = modal.querySelector('#confirmInputWrap');
            const inputLabel_el = modal.querySelector('#confirmInputLabel');
            const inputEl = modal.querySelector('#confirmInput');
            const selectEl = modal.querySelector('#confirmSelect');
            const selectHelp = modal.querySelector('#confirmSelectHelp');
            const inputError = modal.querySelector('#confirmInputError');

            titleEl.textContent = title;
            messageEl.textContent = message;
            cancelBtn.textContent = cancelText;
            confirmBtn.textContent = confirmText;
            confirmBtn.className = `btn btn-${type}`;

            // Handle optional input field
            const hasInput = !!inputLabel;
            const hasSelect = !!selectLabel;
            if (hasInput || hasSelect) {
                inputWrap.style.display = 'block';
                inputLabel_el.textContent = hasSelect ? selectLabel : inputLabel;
                inputLabel_el.insertAdjacentHTML('beforeend', ' <span style="color: var(--danger, #ef4444);">*</span>');
                inputEl.placeholder = inputPlaceholder || '';
                inputEl.style.display = hasInput ? '' : 'none';
                inputEl.value = '';
                selectEl.style.display = hasSelect ? '' : 'none';
                selectEl.replaceChildren();
                if (hasSelect) {
                    const placeholderOption = document.createElement('option');
                    placeholderOption.value = '';
                    placeholderOption.textContent = selectPlaceholder;
                    selectEl.appendChild(placeholderOption);
                    (Array.isArray(selectOptions) ? selectOptions : []).forEach(option => {
                        const optionEl = document.createElement('option');
                        optionEl.value = option.value;
                        optionEl.textContent = option.label;
                        selectEl.appendChild(optionEl);
                    });
                    selectEl.value = selectDefault;
                    selectEl.style.borderColor = 'var(--border)';
                }
                selectHelp.textContent = selectHelpText;
                selectHelp.style.display = hasSelect && selectHelpText ? 'block' : 'none';
                inputError.style.display = 'none';
                inputEl.style.borderColor = 'var(--border)';
            } else {
                inputWrap.style.display = 'none';
                inputEl.value = '';
                selectEl.replaceChildren();
            }

            const cleanup = (result) => {
                modal.classList.remove('active');
                confirmBtn.onclick = null;
                cancelBtn.onclick = null;
                modal.onclick = null;
                if (inputEl) {
                    inputEl.oninput = null;
                    inputEl.onkeydown = null;
                }
                if (selectEl) selectEl.onkeydown = null;
                resolve(result);
            };

            if (hasInput) {
                inputEl.oninput = () => {
                    if (inputEl.value.trim()) {
                        inputError.style.display = 'none';
                        inputEl.style.borderColor = 'var(--border)';
                    }
                };
                inputEl.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        confirmBtn.click();
                    }
                };
            }
            if (hasSelect) {
                selectEl.onkeydown = (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        confirmBtn.click();
                    }
                };
            }
            confirmBtn.onclick = () => {
                if (hasInput) {
                    const val = inputEl.value.trim();
                    if (!val) {
                        inputError.textContent = 'This field is required.';
                        inputError.style.display = 'block';
                        inputEl.style.borderColor = 'var(--danger, #ef4444)';
                        inputEl.focus();
                        return;
                    }
                    cleanup(val);
                } else if (hasSelect) {
                    const val = selectEl.value;
                    if (!val) {
                        inputError.textContent = 'Please select a staff member.';
                        inputError.style.display = 'block';
                        selectEl.style.borderColor = 'var(--danger, #ef4444)';
                        selectEl.focus();
                        return;
                    }
                    cleanup(val);
                } else {
                    cleanup(true);
                }
            };
            cancelBtn.onclick = () => cleanup(false);
            modal.onclick = (e) => {
                if (e.target === modal) cleanup(false);
            };

            setTimeout(() => {
                modal.classList.add('active');
                if (hasInput) inputEl.focus();
            }, 10);
        });
    }

    function initializeNotificationDropdown(loadNotifications) {
        const wrapper = document.getElementById('notificationDropdown');
        const button = document.getElementById('topbarNotificationBtn');
        const menu = document.getElementById('notificationMenu');
        const list = document.getElementById('notificationList');
        const badge = document.getElementById('topbarNotificationBadge');
        if (!wrapper || !button || !menu || !list || typeof loadNotifications !== 'function') return;
        if (wrapper.dataset.initialized === 'true') return;
        wrapper.dataset.initialized = 'true';
        const notificationIdentity = () => {
            const userId = window.auth?.currentUser?.uid;
            if (userId) return userId;
            try {
                const storedUser = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
                return storedUser?.id || storedUser?.uid || window.location.pathname;
            } catch (error) {
                console.error('Could not determine notification account:', error);
                return window.location.pathname;
            }
        };
        const readStorageKey = () => `mislend_read_notifications:${notificationIdentity()}`;
        let readNotificationIds = new Set();
        try {
            const storedIds = JSON.parse(localStorage.getItem(readStorageKey()) || '[]');
            if (Array.isArray(storedIds)) readNotificationIds = new Set(storedIds.filter(id => typeof id === 'string'));
        } catch (error) {
            console.error('Could not load read notification state:', error);
        }
        const getNotificationId = notification => String(notification.id ||
            `${notification.view || ''}|${notification.title || ''}|${notification.message || ''}|${notification.createdAt?.toMillis?.() || notification.createdAt?.toDate?.().getTime?.() || notification.createdAt || ''}`);
        let unreadNotificationCount = 0;

        const closeMenu = () => {
            wrapper.classList.remove('open');
            button.setAttribute('aria-expanded', 'false');
            menu.setAttribute('aria-hidden', 'true');
        };

        const renderNotifications = notifications => {
            const timestampValue = value => {
                if (!value) return 0;
                if (typeof value.toMillis === 'function') return value.toMillis();
                if (typeof value.toDate === 'function') return value.toDate().getTime();
                const timestamp = new Date(value).getTime();
                return Number.isNaN(timestamp) ? 0 : timestamp;
            };
            const latestFirst = notifications.slice().sort((a, b) =>
                timestampValue(b.createdAt) - timestampValue(a.createdAt)
            );
            const visibleNotifications = latestFirst.slice(0, 10);
            unreadNotificationCount = latestFirst.filter(notification => !readNotificationIds.has(getNotificationId(notification))).length;
            badge.textContent = unreadNotificationCount > 9 ? '9+' : String(unreadNotificationCount);
            badge.hidden = unreadNotificationCount === 0;
            list.replaceChildren();

            if (visibleNotifications.length === 0) {
                const empty = document.createElement('div');
                empty.className = 'notification-empty';
                empty.textContent = "You're all caught up.";
                list.appendChild(empty);
                return;
            }

            visibleNotifications.forEach(notification => {
                const item = document.createElement('button');
                item.className = 'notification-item';
                item.type = 'button';
                item.dataset.view = notification.view;
                item.dataset.notificationId = getNotificationId(notification);
                const isUnread = !readNotificationIds.has(item.dataset.notificationId);
                item.classList.toggle('notification-unread', isUnread);

                const icon = document.createElement('span');
                icon.className = 'notification-item-icon';
                icon.setAttribute('aria-hidden', 'true');
                icon.innerHTML = '<i class="fa-regular fa-bell"></i>';

                const content = document.createElement('span');
                content.className = 'notification-item-content';
                const title = document.createElement('span');
                title.className = 'notification-item-title';
                title.textContent = notification.title;
                const message = document.createElement('span');
                message.className = 'notification-item-message';
                message.textContent = notification.message;
                content.append(title, message);
                item.append(icon, content);
                if (isUnread) {
                    const unreadDot = document.createElement('span');
                    unreadDot.className = 'notification-unread-dot';
                    unreadDot.setAttribute('aria-label', 'Unread');
                    item.appendChild(unreadDot);
                }
                list.appendChild(item);
            });
        };

        const refresh = async () => {
            list.innerHTML = '<div class="notification-empty">Loading notifications...</div>';
            try {
                const notifications = await loadNotifications();
                renderNotifications(Array.isArray(notifications) ? notifications : []);
            } catch (error) {
                console.error('Could not load notifications:', error);
                list.innerHTML = '<div class="notification-empty notification-error">Unable to load notifications. Please try again.</div>';
                badge.hidden = true;
            }
        };

        button.addEventListener('click', () => {
            const isOpen = wrapper.classList.toggle('open');
            button.setAttribute('aria-expanded', String(isOpen));
            menu.setAttribute('aria-hidden', String(!isOpen));
            if (isOpen) refresh();
        });

        menu.setAttribute('aria-hidden', 'true');

        list.addEventListener('click', event => {
            const item = event.target.closest('.notification-item');
            if (!item) return;
            const notificationId = item.dataset.notificationId;
            if (notificationId && !readNotificationIds.has(notificationId)) {
                readNotificationIds.add(notificationId);
                item.classList.remove('notification-unread');
                item.querySelector('.notification-unread-dot')?.remove();
                unreadNotificationCount = Math.max(0, unreadNotificationCount - 1);
                badge.textContent = unreadNotificationCount > 9 ? '9+' : String(unreadNotificationCount);
                badge.hidden = unreadNotificationCount === 0;
                try {
                    localStorage.setItem(readStorageKey(), JSON.stringify(Array.from(readNotificationIds).slice(-300)));
                } catch (error) {
                    console.error('Could not save read notification state:', error);
                }
            }
            const destination = Array.from(document.querySelectorAll('.nav-item'))
                .find(nav => nav.dataset.view === item.dataset.view);
            closeMenu();
            destination?.click();
        });

        document.addEventListener('click', event => {
            if (!wrapper.contains(event.target)) closeMenu();
        });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeMenu();
        });

        window.refreshNotificationDropdown = refresh;
    }

    function formatDate(timestamp) {
        if (!timestamp) return 'N/A';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        const options = {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        };
        return date.toLocaleString('en-US', options).replace(',', '');
    }

    function getBorrowingActivityEvents(borrowing) {
        const savedEvents = Array.isArray(borrowing.activityHistory) ? borrowing.activityHistory : [];
        if (savedEvents.length) {
            return savedEvents.map(event => ({ ...event }));
        }

        const events = [];
        const isBorrowed = ['borrowed', 'pending_return', 'pending_extension', 'returned'].includes(borrowing.status);
        if (isBorrowed || borrowing.approvedAt || borrowing.approvedByName || borrowing.approvedBy) {
            events.push({
                type: 'borrowed',
                at: borrowing.approvedAt || borrowing.borrowedAt || borrowing.createdAt,
                staffName: borrowing.approvedByName || borrowing.approvedBy || '',
                expectedReturnTime: borrowing.expectedReturnTime || ''
            });
        } else if (['pending_borrow', 'rejected'].includes(borrowing.status)) {
            events.push({
                type: borrowing.status,
                at: borrowing.borrowedAt || borrowing.createdAt,
                staffName: '',
                expectedReturnTime: borrowing.expectedReturnTime || ''
            });
        }

        if (borrowing.hasExtension || borrowing.extensionApprovedAt) {
            events.push({
                type: 'extended',
                at: borrowing.extensionApprovedAt || borrowing.updatedAt || borrowing.borrowedAt,
                staffName: borrowing.extensionApprovedByName || '',
                previousReturnTime: borrowing.originalExpectedReturnTime || '',
                expectedReturnTime: borrowing.expectedReturnTime || '',
                reason: borrowing.extensionReason || ''
            });
        }

        if (borrowing.status === 'pending_return') {
            events.push({
                type: 'return_requested',
                at: borrowing.returnRequestedAt || borrowing.updatedAt || borrowing.borrowedAt,
                condition: borrowing.pendingReturnCondition || '',
                notes: borrowing.pendingReturnNotes || ''
            });
        }

        if (borrowing.status === 'returned' || borrowing.returnedAt) {
            events.push({
                type: 'returned',
                at: borrowing.returnedAt || borrowing.returnConfirmedAt || borrowing.returnApprovedAt,
                staffName: borrowing.returnApprovedByName || borrowing.returnConfirmedByName || '',
                condition: borrowing.returnCondition || '',
                notes: borrowing.returnNotes || ''
            });
        }

        return events;
    }

    function escapeBorrowingHistoryHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[character]);
    }

    function getBorrowingDueAt(borrowedAtValue, expectedReturnTime) {
        if (!borrowedAtValue || typeof expectedReturnTime !== 'string') return null;

        const timeMatch = expectedReturnTime.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
        if (!timeMatch) return null;

        const borrowedAt = typeof borrowedAtValue.toDate === 'function'
            ? borrowedAtValue.toDate()
            : new Date(borrowedAtValue);
        let hours = Number(timeMatch[1]);
        const minutes = Number(timeMatch[2]);
        const meridiem = timeMatch[3]?.toUpperCase();
        if (Number.isNaN(borrowedAt.getTime()) || minutes > 59) return null;
        if (meridiem) {
            if (hours < 1 || hours > 12) return null;
            if (meridiem === 'PM' && hours < 12) hours += 12;
            if (meridiem === 'AM' && hours === 12) hours = 0;
        } else if (hours > 23) {
            return null;
        }

        const dateParts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Manila',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(borrowedAt).reduce((parts, part) => {
            if (part.type !== 'literal') parts[part.type] = Number(part.value);
            return parts;
        }, {});

        return new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, hours - 8, minutes));
    }

    function isOverdueStrikeActive(borrowing, now = new Date()) {
        if (!borrowing || borrowing.status !== 'returned' || borrowing.wasOverdue !== true) return false;
        const returnedAt = borrowing.returnedAt || borrowing.returnConfirmedAt || borrowing.returnApprovedAt;
        const returnedDate = typeof returnedAt?.toDate === 'function'
            ? returnedAt.toDate()
            : new Date(typeof returnedAt?.seconds === 'number' ? returnedAt.seconds * 1000 : returnedAt);
        if (!Number.isFinite(returnedDate.getTime())) return false;

        const cutoff = new Date(now);
        const dayOfMonth = cutoff.getDate();
        cutoff.setDate(1);
        cutoff.setMonth(cutoff.getMonth() - 1);
        const lastDayOfPreviousMonth = new Date(cutoff.getFullYear(), cutoff.getMonth() + 1, 0).getDate();
        cutoff.setDate(Math.min(dayOfMonth, lastDayOfPreviousMonth));
        return returnedDate > cutoff && returnedDate <= now;
    }

    function formatTimeTo12h(timeStr) {
        if (!timeStr || !timeStr.includes(':')) return timeStr || 'N/A';
        const [hh, mm] = timeStr.split(':').map(Number);
        const ampm = hh >= 12 ? 'PM' : 'AM';
        const h12 = hh % 12 || 12;
        const mPad = String(mm).padStart(2, '0');
        return `${h12}:${mPad} ${ampm}`;
    }

    function capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function getUserInitials(name) {
        if (!name) return 'U';
        const parts = name.split(' ');
        if (parts.length >= 2) {
            return parts[0][0] + parts[parts.length - 1][0];
        }
        return name.substring(0, 2);
    }

    function checkAuth(requiredRole = null) {
        return new Promise((resolve, reject) => {
            const unsub = mainAuth.onAuthStateChanged(async (user) => {
                unsub();

                if (!user) {
                    window.location.href = 'login.html';
                    reject('Not authenticated');
                    return;
                }

                if (!requiredRole) {
                    resolve({ user });
                    return;
                }

                try {
                    const userDoc = await dbInstance.collection('users').doc(user.uid).get();
                    const userData = userDoc.data();

                    const role = normalizeBarangayRole(userData);
                    const roleMatches = requiredRole === 'official'
                        ? ['kagawad', 'treasurer', 'secretary', 'tanod', 'captain', 'superadmin'].includes(role)
                        : requiredRole === 'resident'
                            ? role === 'resident'
                            : userData?.role === requiredRole;
                    if (roleMatches) {
                        // Monitor for real-time account suspension
                        dbInstance.collection('users').doc(user.uid).onSnapshot(doc => {
                            const updatedData = doc.data();
                            if (updatedData && updatedData.status === 'suspended') {
                                mainAuth.signOut().then(() => {
                                    localStorage.setItem('mislend_suspended_lockout', 'true');
                                    window.location.href = 'login.html';
                                });
                            }
                        }, err => {
                            console.error('Account status listener error:', err);
                        });

                        resolve({ user, userData });
                    } else {
                        let targetUrl = 'resident.html';
                        if (['kagawad', 'treasurer', 'secretary', 'tanod', 'captain', 'superadmin'].includes(role)) targetUrl = 'admin.html';

                        if (window.location.search && targetUrl !== 'admin.html') {
                            targetUrl += window.location.search;
                        }

                        window.location.href = targetUrl;
                        reject('Wrong role');
                    }
                } catch (err) {
                    console.error('Role check error:', err);
                    window.location.href = 'login.html';
                    reject(err);
                }
            });
        });
    }

    function normalizeBarangayRole(userData = {}) {
        const role = String(userData.role || '').toLowerCase();
        if (role === 'student') return 'resident';
        if (role === 'professor') return 'captain';
        if (role === 'admin') {
            return userData.isHeadAdmin === true || userData.isHeadAdmin === 'true' || userData.adminType === 'head_admin'
                ? 'superadmin'
                : 'captain';
        }
        return role;
    }

    const barangayPageDefinitions = {
        dashboard: { title: 'Dashboard', icon: 'fa-chart-column' },
        assigned_committee: { title: 'Assigned Committee', collection: 'committee_assignments', icon: 'fa-people-group', columns: ['committee', 'position', 'description', 'status'] },
        residents: { title: 'Resident Records', collection: 'users', icon: 'fa-users', columns: ['id', 'name', 'username', 'mobile', 'street', 'status'], statuses: ['pending', 'approved', 'suspended'], readOnly: true },
        complaint_monitoring: { title: 'Complaint Monitoring', collection: 'complaints', icon: 'fa-triangle-exclamation', columns: ['subject', 'location', 'status', 'createdAt'], statuses: ['pending', 'under_review', 'for_mediation', 'resolved', 'dismissed'] },
        community_projects: { title: 'Community Projects', collection: 'community_projects', icon: 'fa-building-flag', columns: ['title', 'committee', 'budget', 'status'], statuses: ['planned', 'ongoing', 'completed', 'cancelled'], fields: [['title', 'Project title', 'text', true], ['description', 'Description', 'textarea', true], ['committee', 'Committee', 'text'], ['budget', 'Budget', 'number'], ['startDate', 'Start date', 'date'], ['endDate', 'End date', 'date']] },
        activity_monitoring: { title: 'Activity Monitoring', collection: 'activity_logs', icon: 'fa-list-check', columns: ['activity', 'category', 'details', 'activityDate'], fields: [['activity', 'Activity', 'text', true], ['category', 'Category', 'text'], ['details', 'Details', 'textarea']] },
        incident_reports: { title: 'Incident Reports', collection: 'incidents', icon: 'fa-file-circle-exclamation', columns: ['title', 'category', 'location', 'status', 'createdAt'], statuses: ['pending', 'under_review', 'referred', 'resolved', 'closed'], fields: [['title', 'Incident title', 'text', true], ['category', 'Category', 'text'], ['description', 'Description', 'textarea', true], ['location', 'Location', 'text'], ['incidentDate', 'Date and time', 'datetime-local']] },
        announcements: { title: 'Announcements', collection: 'announcements', icon: 'fa-bullhorn', columns: ['title', 'category', 'publishAt', 'status'], fields: [['title', 'Announcement title', 'text', true], ['body', 'Announcement', 'textarea', true], ['category', 'Category', 'text'], ['expiresAt', 'Expiry date', 'date']] },
        financial_overview: { title: 'Financial Overview', collection: 'income_records', icon: 'fa-chart-line', columns: ['description', 'category', 'amount', 'transactionDate'] },
        income_records: { title: 'Income Records', collection: 'income_records', icon: 'fa-arrow-trend-up', columns: ['reference', 'description', 'category', 'amount', 'transactionDate'], fields: [['reference', 'Reference number', 'text'], ['description', 'Description', 'text', true], ['category', 'Category', 'text'], ['amount', 'Amount', 'number', true], ['receivedFrom', 'Received from', 'text'], ['transactionDate', 'Date', 'date']] },
        expense_records: { title: 'Expense Records', collection: 'expense_records', icon: 'fa-arrow-trend-down', columns: ['reference', 'description', 'category', 'amount', 'transactionDate'], fields: [['reference', 'Reference number', 'text'], ['description', 'Description', 'text', true], ['category', 'Category', 'text'], ['amount', 'Amount', 'number', true], ['paidTo', 'Paid to', 'text'], ['transactionDate', 'Date', 'date']] },
        budget_management: { title: 'Budget Management', collection: 'budgets', icon: 'fa-wallet', columns: ['fiscal_year', 'category', 'allocated_amount'], fields: [['fiscal_year', 'Fiscal year', 'number', true], ['category', 'Category', 'text', true], ['allocated_amount', 'Allocated amount', 'number', true], ['notes', 'Notes', 'textarea']] },
        collection_records: { title: 'Collection Records', collection: 'collection_records', icon: 'fa-cash-register', columns: ['residentName', 'description', 'amount', 'collectionDate', 'status'], statuses: ['due', 'collected', 'void'], fields: [['residentName', 'Resident', 'text', true], ['description', 'Collection description', 'text', true], ['amount', 'Amount', 'number', true], ['collectionDate', 'Collection date', 'date']] },
        payment_transactions: { title: 'Payment Transactions', collection: 'payment_transactions', icon: 'fa-money-bill-transfer', columns: ['requestType', 'amount', 'method', 'status', 'createdAt'], statuses: ['pending', 'paid', 'failed', 'refunded'] },
        financial_reports: { title: 'Financial Reports', collection: 'income_records', icon: 'fa-file-invoice-dollar', columns: ['description', 'category', 'amount', 'transactionDate'], report: true },
        audit_records: { title: 'Audit Records', collection: 'audit_records', icon: 'fa-clipboard-check', columns: ['action', 'entity', 'entityId', 'createdAt'], readOnly: true },
        household_records: { title: 'Household Records', collection: 'households', icon: 'fa-house-user', columns: ['householdCode', 'houseNo', 'street', 'barangayNo', 'familySize'], fields: [['householdCode', 'Household number', 'text'], ['headOfHouseholdId', 'Head of household account ID', 'text'], ['memberUserIds', 'Resident account IDs (comma-separated)', 'text'], ['houseNo', 'House number', 'text'], ['street', 'Street', 'text', true], ['barangayNo', 'Barangay number', 'text'], ['familySize', 'Family size', 'number']] },
        certificate_requests: { title: 'Certificate Requests', collection: 'certificate_requests', icon: 'fa-file-signature', columns: ['requestType', 'purpose', 'status', 'createdAt'], statuses: ['pending', 'under_review', 'approved', 'rejected', 'ready_for_pickup', 'released'] },
        certificate_issuance: { title: 'Certificate Issuance', collection: 'certificate_requests', icon: 'fa-file-circle-check', columns: ['requestType', 'purpose', 'status', 'releaseDate'], statuses: ['approved', 'ready_for_pickup', 'released'] },
        blotter_records: { title: 'Blotter Records', collection: 'blotter_records', icon: 'fa-book', columns: ['blotterNumber', 'complainantName', 'subject', 'status'], statuses: ['open', 'for_mediation', 'referred', 'resolved', 'closed'], fields: [['blotterNumber', 'Blotter number', 'text'], ['complainantName', 'Complainant', 'text', true], ['respondentName', 'Respondent', 'text'], ['subject', 'Subject', 'text', true], ['narrative', 'Narrative', 'textarea', true], ['location', 'Location', 'text'], ['incidentDate', 'Incident date', 'datetime-local']] },
        complaint_records: { title: 'Complaint Records', collection: 'complaints', icon: 'fa-comments', columns: ['subject', 'location', 'status', 'createdAt'], statuses: ['pending', 'under_review', 'for_mediation', 'resolved', 'dismissed'] },
        meeting_minutes: { title: 'Meeting Minutes', collection: 'meeting_minutes', icon: 'fa-file-lines', columns: ['title', 'meetingDate', 'recordedBy'], fields: [['title', 'Meeting title', 'text', true], ['meetingDate', 'Meeting date', 'date'], ['content', 'Minutes', 'textarea', true]] },
        document_management: { title: 'Document Management', collection: 'document_records', icon: 'fa-folder-open', columns: ['title', 'category', 'description', 'createdAt'], fields: [['title', 'Document title', 'text', true], ['category', 'Category', 'text'], ['description', 'Description', 'textarea'], ['fileUrl', 'Document URL', 'url']] },
        reports: { title: 'Reports', collection: 'certificate_requests', icon: 'fa-chart-pie', columns: ['requestType', 'purpose', 'status', 'createdAt'], report: true },
        officials_staff: { title: 'Officials & Staff', collection: 'users', icon: 'fa-user-tie', columns: ['name', 'username', 'role', 'email', 'status'], accountManagement: true },
        certificate_approvals: { title: 'Certificate Approvals', collection: 'certificate_requests', icon: 'fa-file-circle-check', columns: ['requestType', 'purpose', 'status', 'createdAt'], statuses: ['pending', 'under_review', 'approved', 'rejected', 'ready_for_pickup', 'released'] },
        complaint_approvals: { title: 'Complaint Approvals', collection: 'complaints', icon: 'fa-circle-check', columns: ['subject', 'location', 'status', 'createdAt'], statuses: ['pending', 'under_review', 'for_mediation', 'resolved', 'dismissed'] },
        meeting_schedules: { title: 'Meeting Schedules', collection: 'meetings', icon: 'fa-calendar-days', columns: ['title', 'meetingDate', 'location', 'status'], statuses: ['scheduled', 'completed', 'cancelled'], fields: [['title', 'Meeting title', 'text', true], ['agenda', 'Agenda', 'textarea'], ['meetingDate', 'Meeting date and time', 'datetime-local', true], ['location', 'Location', 'text']] },
        patrol_logs: { title: 'Patrol Logs', collection: 'patrol_logs', icon: 'fa-shield-halved', columns: ['patrolDate', 'shift', 'area', 'incidentsReported'], fields: [['patrolDate', 'Patrol date', 'date', true], ['shift', 'Shift', 'text'], ['area', 'Patrol area', 'text', true], ['observations', 'Observations', 'textarea'], ['incidentsReported', 'Incidents reported', 'number']] },
        blotter_assistance: { title: 'Blotter Assistance', collection: 'blotter_records', icon: 'fa-handshake-angle', columns: ['blotterNumber', 'complainantName', 'subject', 'status'], fields: [['blotterNumber', 'Blotter number', 'text'], ['complainantName', 'Complainant', 'text', true], ['respondentName', 'Respondent', 'text'], ['subject', 'Subject', 'text', true], ['narrative', 'Notes', 'textarea', true], ['location', 'Location', 'text']] },
        emergency_reports: { title: 'Emergency Reports', collection: 'emergency_reports', icon: 'fa-truck-medical', columns: ['title', 'emergencyType', 'location', 'status'], statuses: ['pending', 'responding', 'resolved', 'closed'] },
        patrol_schedule: { title: 'Assigned Patrol Schedule', collection: 'patrol_schedules', icon: 'fa-calendar-check', columns: ['patrolDate', 'shift', 'area', 'status'], readOnly: true },
        resident_home: { title: 'Dashboard', icon: 'fa-chart-column' },
        my_profile: { title: 'My Profile', icon: 'fa-user', profile: true },
        my_household: { title: 'My Household', collection: 'household_members', icon: 'fa-house', columns: ['fullName', 'relationship', 'dateOfBirth', 'sex'], readOnly: true },
        request_certificate: { title: 'Request Certificate', collection: 'certificate_requests', icon: 'fa-file-signature', fixedRequestType: 'barangay_certificate', columns: ['requestType', 'purpose', 'status', 'createdAt'], fields: [['purpose', 'Purpose of request', 'textarea', true]] },
        barangay_clearance: { title: 'Barangay Clearance', collection: 'certificate_requests', icon: 'fa-file-circle-check', fixedRequestType: 'barangay_clearance', columns: ['requestType', 'purpose', 'status', 'createdAt'], fields: [['purpose', 'Purpose of clearance', 'textarea', true]] },
        business_clearance: { title: 'Business Clearance', collection: 'certificate_requests', icon: 'fa-store', fixedRequestType: 'business_clearance', columns: ['businessName', 'purpose', 'status', 'createdAt'], fields: [['businessName', 'Business name', 'text', true], ['businessAddress', 'Business address', 'text', true], ['purpose', 'Purpose of clearance', 'textarea', true]] },
        submit_complaint: { title: 'Submit Complaint', collection: 'complaints', icon: 'fa-comment-dots', columns: ['subject', 'location', 'status', 'createdAt'], fields: [['subject', 'Subject', 'text', true], ['description', 'Complaint details', 'textarea', true], ['location', 'Location', 'text'], ['respondentName', 'Person involved', 'text']] },
        report_incident: { title: 'Report Incident', collection: 'incidents', icon: 'fa-triangle-exclamation', columns: ['title', 'category', 'location', 'status'], fields: [['title', 'Incident title', 'text', true], ['category', 'Category', 'text'], ['description', 'Incident details', 'textarea', true], ['location', 'Location', 'text', true], ['incidentDate', 'Date and time', 'datetime-local']] },
        appointments: { title: 'Appointments', collection: 'appointments', icon: 'fa-calendar-check', columns: ['purpose', 'appointmentDate', 'status'], fields: [['purpose', 'Appointment purpose', 'text', true], ['appointmentDate', 'Preferred date and time', 'datetime-local', true], ['notes', 'Notes', 'textarea']] },
        my_transactions: { title: 'My Transactions', collection: 'certificate_requests', icon: 'fa-receipt', columns: ['requestType', 'purpose', 'status', 'createdAt'], readOnly: true, transactions: true },
        resident_announcements: { title: 'Announcements', collection: 'announcements', icon: 'fa-bullhorn', columns: ['title', 'category', 'publishAt'], readOnly: true },
        resident_notifications: { title: 'Notifications', collection: 'notifications', icon: 'fa-bell', columns: ['title', 'body', 'createdAt'], readOnly: true },
        settings: { title: 'Settings', icon: 'fa-gear', settings: true }
    };

    const rolePageIds = {
        kagawad: ['dashboard', 'assigned_committee', 'residents', 'complaint_monitoring', 'community_projects', 'activity_monitoring', 'incident_reports', 'announcements', 'profile_settings'],
        treasurer: ['dashboard', 'financial_overview', 'income_records', 'expense_records', 'budget_management', 'collection_records', 'payment_transactions', 'financial_reports', 'audit_records', 'profile_settings'],
        secretary: ['dashboard', 'residents', 'household_records', 'certificate_requests', 'certificate_issuance', 'blotter_records', 'complaint_records', 'meeting_minutes', 'document_management', 'reports', 'announcements', 'profile_settings'],
        tanod: ['dashboard', 'incident_reports', 'patrol_logs', 'blotter_assistance', 'emergency_reports', 'patrol_schedule', 'profile_settings'],
        captain: ['dashboard', 'residents', 'household_records', 'officials_staff', 'certificate_approvals', 'complaint_approvals', 'blotter_records', 'financial_overview', 'reports', 'announcements', 'meeting_schedules', 'profile_settings'],
        resident: ['resident_home', 'my_profile', 'my_household', 'request_certificate', 'barangay_clearance', 'business_clearance', 'submit_complaint', 'report_incident', 'appointments', 'my_transactions', 'resident_announcements', 'resident_notifications', 'settings']
    };
    function escapeBarangayHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    function formatBarangayValue(value) {
        if (value === null || value === undefined || value === '') return '—';
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        if (typeof value === 'object') value = value.toDate ? value.toDate().toLocaleString() : JSON.stringify(value);
        const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null;
        return escapeBarangayHtml(date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : value);
    }

    function initializeBarangayDashboard(user, userData) {
        const role = normalizeBarangayRole(userData);
        if (role === 'admin' || role === 'superadmin') {
            rolePageIds.superadmin = [...new Set(
                ['kagawad', 'treasurer', 'secretary', 'tanod', 'captain']
                    .flatMap(staffRole => rolePageIds[staffRole])
                    .filter(id => id !== 'profile_settings')
            )];
            rolePageIds.superadmin.push('officials_staff', 'profile_settings');
        }
        const pageIds = rolePageIds[role];
        if (!pageIds) throw new Error(`No barangay dashboard is configured for role "${role}".`);

        const menu = document.querySelector('.sidebar-menu');
        const content = document.getElementById('dashboardView');
        if (!menu || !content) throw new Error('The dashboard shell is incomplete.');
        document.querySelectorAll('.view-container').forEach(view => {
            if (view !== content) view.remove();
        });
        content.innerHTML = '';
        content.classList.add('active');

        const uniquePages = [...new Set(pageIds)];
        const profileSettings = { id: 'profile_settings', ...barangayPageDefinitions.my_profile, title: 'Profile Settings', profile: true };
        const pages = uniquePages.map(id => id === 'profile_settings' ? profileSettings : ({ id, ...barangayPageDefinitions[id] }));
        const activeKey = `brgy-active-view-${role}`;
        const labelById = Object.fromEntries(pages.map(page => [page.id, page.title]));
        const roleName = role === 'superadmin' ? 'Superadmin' : role === 'resident' ? 'Resident' : role.charAt(0).toUpperCase() + role.slice(1);

        const groupName = page => page.id.includes('profile') || page.id === 'settings' ? 'ACCOUNT' :
            ['dashboard', 'resident_home', 'financial_overview'].includes(page.id) ? 'OVERVIEW' : 'BARANGAY SERVICES';
        const groups = [...new Set(pages.map(groupName))];
        menu.innerHTML = groups.map(group => `
            <div class="sidebar-menu-label">${group}</div>
            <ul class="sidebar-menu-inner">${pages.filter(page => groupName(page) === group).map(page => `
                <li class="sidebar-item" data-view="${page.id}">
                    <a href="#" class="sidebar-link nav-item" data-view="${page.id}">
                        <span class="sidebar-icon"><i class="fa-solid ${page.icon || 'fa-file-lines'}"></i></span>
                        <span class="sidebar-text">${escapeBarangayHtml(page.title)}</span>
                    </a>
                </li>`).join('')}
            </ul>`).join('');

        document.querySelectorAll('.logo span, .topbar-brand-name').forEach(el => { el.textContent = 'Barangay'; });
        document.querySelectorAll('.logo img, .topbar-brand img').forEach(img => { img.alt = 'Barangay Management System'; });
        const topbarName = document.querySelector('.topbar-user-name, #topbarUserName');
        const menuName = document.querySelector('.profile-menu-name, #menuUserName');
        const emailEl = document.querySelector('.profile-menu-email, #menuUserEmail, #topbarAdminEmail');
        [topbarName, menuName].filter(Boolean).forEach(el => { el.textContent = userData.name || user.displayName || roleName; });
        if (emailEl) emailEl.textContent = user.email || userData.email || '';
        document.querySelectorAll('.topbar-user-role').forEach(el => { el.textContent = roleName; });
        const avatar = document.getElementById('topbarAvatarContainer');
        const menuAvatar = document.getElementById('menuAvatarContainer');
        [avatar, menuAvatar].filter(Boolean).forEach(el => {
            el.innerHTML = userData.photoURL
                ? `<img src="${escapeBarangayHtml(userData.photoURL)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
                : `<span>${escapeBarangayHtml((userData.firstName || roleName).slice(0, 1).toUpperCase())}</span>`;
        });
        const searchInput = document.getElementById('topbarSearchInput');
        if (searchInput) {
            searchInput.placeholder = 'Search barangay records...';
            searchInput.setAttribute('aria-label', 'Search barangay records');
        }
        const mobileNav = document.querySelector('.bottom-nav');
        if (mobileNav) mobileNav.style.display = 'none';

        let currentPage = pages.find(page => page.id === localStorage.getItem(activeKey)) || pages[0];
        const loadRows = async page => {
            const snapshot = await window.db.collection(page.collection).get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        };
        const setPage = async pageId => {
            const next = pages.find(page => page.id === pageId);
            if (!next) return;
            currentPage = next;
            try { localStorage.setItem(activeKey, pageId); } catch (error) { console.warn('Could not save dashboard page preference:', error); }
            document.querySelectorAll('.nav-item, .sidebar-item, .bottom-nav-item').forEach(el => {
                el.classList.toggle('active', el.dataset.view === pageId);
            });
            const section = document.getElementById('breadcrumbSection');
            const label = labelById[pageId] || next.title;
            const currentLabel = document.getElementById('breadcrumbCurrent');
            const mobileTitle = document.getElementById('topbarMobileTitle');
            if (section) section.textContent = groupName(next).replace(/\b[a-z]/g, letter => letter.toUpperCase());
            if (currentLabel) currentLabel.textContent = label;
            if (mobileTitle) mobileTitle.textContent = label;
            content.innerHTML = `<div class="content-header"><div><h1 class="page-title">${escapeBarangayHtml(label)}</h1><p class="page-subtitle">Barangay Management System · ${escapeBarangayHtml(roleName)}</p></div></div><div class="stat-card">Loading records...</div>`;
            if (next.id === 'dashboard' || next.id === 'resident_home' || next.id === 'financial_overview') {
                await renderBarangayHome(next);
            } else if (next.profile || next.id === 'my_profile' || next.id === 'profile_settings') {
                renderBarangayProfile(next);
            } else if (next.settings) {
                renderBarangaySettings();
            } else {
                await renderBarangayRecords(next);
            }
            if (window.innerWidth < 1280) {
                document.getElementById('sidebar')?.classList.remove('mobile-open');
                document.getElementById('sidebarOverlay')?.classList.remove('active');
            }
        };

        async function renderBarangayHome(page) {
            const cards = [];
            if (page.id === 'financial_overview') {
                try {
                    const [incomeRows, expenseRows, budgetRows] = await Promise.all([
                        loadRows({ collection: 'income_records' }),
                        loadRows({ collection: 'expense_records' }),
                        loadRows({ collection: 'budgets' })
                    ]);
                    const total = (rows, field) => rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
                    const currency = amount => new Intl.NumberFormat('en-PH', {
                        style: 'currency',
                        currency: 'PHP'
                    }).format(amount);
                    const income = total(incomeRows, 'amount');
                    const expenses = total(expenseRows, 'amount');
                    cards.push(
                        ['Total Income', currency(income)],
                        ['Total Expenses', currency(expenses)],
                        ['Available Balance', currency(income - expenses)],
                        ['Allocated Budget', currency(total(budgetRows, 'allocated_amount'))]
                    );
                } catch (error) {
                    console.error('Unable to load financial overview:', error);
                    cards.push(['Financial Overview', 'Unable to load totals']);
                }
            } else {
                const counters = role === 'resident'
                    ? [['Certificate Requests', 'certificate_requests'], ['Complaints', 'complaints'], ['Incident Reports', 'incidents'], ['Appointments', 'appointments']]
                    : role === 'treasurer'
                        ? [['Income Records', 'income_records'], ['Expense Records', 'expense_records'], ['Collections', 'collection_records'], ['Payments', 'payment_transactions']]
                        : [['Residents', 'users'], ['Certificate Requests', 'certificate_requests'], ['Complaints', 'complaints'], ['Incident Reports', 'incidents']];
                for (const [title, collection] of counters) {
                    try {
                        const rows = await loadRows({ collection });
                        cards.push([title, rows.filter(row => collection !== 'users' || row.role === 'resident').length]);
                    } catch (error) {
                        console.error(`Unable to load ${title.toLowerCase()} count:`, error);
                        cards.push([title, '—']);
                    }
                }
            }
            content.innerHTML = `
                <div class="content-header"><div><h1 class="page-title">${escapeBarangayHtml(page.title)}</h1><p class="page-subtitle">Welcome, ${escapeBarangayHtml(userData.firstName || userData.name || roleName)}. Here is your barangay workspace.</p></div></div>
                <div class="stats-grid">${cards.map(([title, count]) => `<div class="stat-card"><div class="stat-content"><div class="stat-label">${escapeBarangayHtml(title)}</div><div class="stat-value">${escapeBarangayHtml(count)}</div></div></div>`).join('')}</div>
                <div class="content-header"><div><h2 class="page-title">${role === 'resident' ? 'My account' : 'Quick access'}</h2><p class="page-subtitle">${role === 'resident' ? 'Your requests and profile status appear here.' : 'Use the menu to open the records assigned to your role.'}</p></div></div>
                <div class="stat-card"><strong>${escapeBarangayHtml(userData.name || user.displayName || 'Account')}</strong><p>${escapeBarangayHtml(userData.email || user.email || '')} · ${escapeBarangayHtml(roleName)}</p><p>Account status: ${escapeBarangayHtml(userData.status || 'approved')}</p></div>`;
        }

        function fieldControl(field) {
            const [key, label, type, required] = field;
            if (type === 'textarea') return `<div class="form-group"><label for="brgy-${key}">${escapeBarangayHtml(label)}</label><textarea id="brgy-${key}" name="${key}" rows="3" ${required ? 'required' : ''}></textarea></div>`;
            return `<div class="form-group"><label for="brgy-${key}">${escapeBarangayHtml(label)}</label><input id="brgy-${key}" name="${key}" type="${escapeBarangayHtml(type || 'text')}" ${type === 'number' ? 'min="0" step="0.01"' : ''} ${required ? 'required' : ''}></div>`;
        }

        function renderBarangayProfile(page) {
            const data = userData || {};
            const fields = [
                ['firstName', 'First name', 'text', true], ['middleName', 'Middle name', 'text'], ['lastName', 'Last name', 'text', true],
                ['suffix', 'Suffix', 'text'], ['sex', 'Sex', 'text'], ['dateOfBirth', 'Date of birth', 'date'],
                ['birthplace', 'Birthplace', 'text'], ['houseNo', 'House number', 'text'], ['street', 'Street', 'text'],
                ['barangayNo', 'Barangay number', 'text'], ['city', 'City', 'text'], ['mobile', 'Phone number', 'tel']
            ];
            content.innerHTML = `
                <div class="content-header"><div><h1 class="page-title">${escapeBarangayHtml(page.title)}</h1><p class="page-subtitle">View and update your personal information.</p></div></div>
                <form id="brgyProfileForm" class="stat-card"><div class="register-grid">${fields.map(fieldControl).join('')}
                    ${['isPwd', 'isSoloParent', 'is4ps', 'registeredVoter'].map(key => `<label class="terms-agreement"><input type="checkbox" name="${key}" ${data[key] ? 'checked' : ''}> ${key === 'isPwd' ? 'Person with disability (PWD)' : key === 'isSoloParent' ? 'Solo parent' : key === 'is4ps' ? '4Ps member' : 'Registered voter'}</label>`).join('')}
                    <div class="form-group" id="voterIdGroup"><label for="brgy-voterIdNumber">Voter ID number</label><input id="brgy-voterIdNumber" name="voterIdNumber" type="text"></div>
                    <div class="form-group"><label>Username</label><input value="${escapeBarangayHtml(data.username || '')}" disabled></div>
                    <div class="form-group"><label>Email</label><input value="${escapeBarangayHtml(user.email || data.email || '')}" disabled></div>
                    <button class="btn btn-primary" type="submit">Save Profile</button></div></form>`;
            const form = document.getElementById('brgyProfileForm');
            fields.forEach(([key]) => {
                const input = form.elements.namedItem(key);
                if (input) input.value = data[key] || '';
            });
            const voterId = form.elements.namedItem('voterIdNumber');
            if (voterId) voterId.value = data.voterIdNumber || '';
            const voterCheckbox = form.elements.namedItem('registeredVoter');
            const voterIdInput = form.elements.namedItem('voterIdNumber');
            const updateVoterRequirement = () => { voterIdInput.required = voterCheckbox.checked; };
            voterCheckbox.addEventListener('change', updateVoterRequirement);
            updateVoterRequirement();
            form.addEventListener('submit', async event => {
                event.preventDefault();
                const updates = Object.fromEntries(new FormData(form).entries());
                ['isPwd', 'isSoloParent', 'is4ps', 'registeredVoter'].forEach(key => { updates[key] = form.elements.namedItem(key).checked; });
                updates.name = [updates.firstName, updates.middleName, updates.lastName, updates.suffix].filter(Boolean).join(' ');
                try {
                    await window.db.collection('users').doc(user.uid).update(updates);
                    userData = { ...userData, ...updates };
                    window.showToast('Profile saved.', 'success');
                } catch (error) {
                    console.error('Profile update failed:', error);
                    window.showToast(`Could not save profile: ${error.message}`, 'error');
                }
            });
            if (role !== 'resident') {
                content.insertAdjacentHTML('beforeend', `<div class="content-header"><div><h2 class="page-title">Password Settings</h2><p class="page-subtitle">Change your account password securely.</p></div></div>${passwordSettingsMarkup()}`);
                bindBarangayPasswordSettings();
            }
        }

        function renderBarangaySettings() {
            content.innerHTML = `<div class="content-header"><div><h1 class="page-title">Settings</h1><p class="page-subtitle">Change your password and account security settings.</p></div></div>${passwordSettingsMarkup()}`;
            bindBarangayPasswordSettings();
        }

        function passwordSettingsMarkup() {
            return `<form id="brgyPasswordForm" class="stat-card"><div class="form-group"><label for="brgyCurrentPassword">Current password</label><input id="brgyCurrentPassword" name="currentPassword" type="password" autocomplete="current-password" required></div>
                <div class="form-group"><label for="brgyNewPassword">New password</label><input id="brgyNewPassword" name="newPassword" type="password" minlength="8" autocomplete="new-password" required></div>
                <div class="form-group"><label for="brgyOtp">Email verification code</label><input id="brgyOtp" name="otpCode" inputmode="numeric" autocomplete="one-time-code"></div>
                <button class="btn btn-secondary" id="brgySendOtp" type="button">Send verification code</button> <button class="btn btn-primary" type="submit">Update Password</button></form>`;
        }

        function bindBarangayPasswordSettings() {
            document.getElementById('brgySendOtp').addEventListener('click', async event => {
                event.currentTarget.disabled = true;
                try {
                    await window.auth.sendPasswordOtp(user.email, 'change');
                    window.showToast('Verification code sent to your email.', 'success');
                } catch (error) {
                    window.showToast(`Could not send code: ${error.message}`, 'error');
                } finally {
                    event.currentTarget.disabled = false;
                }
            });
            document.getElementById('brgyPasswordForm').addEventListener('submit', async event => {
                event.preventDefault();
                const form = event.currentTarget;
                const values = Object.fromEntries(new FormData(form).entries());
                if (values.newPassword.length < 8) return window.showToast('Use at least 8 characters for the new password.', 'error');
                try {
                    await user.updatePassword(values.newPassword, values.currentPassword, values.otpCode);
                    form.reset();
                    window.showToast('Password updated.', 'success');
                } catch (error) {
                    window.showToast(`Could not update password: ${error.message}`, 'error');
                }
            });
        }

        async function renderBarangayRecords(page) {
            if (page.accountManagement) {
                await renderOfficialAccountForm(page);
                return;
            }
            if (page.transactions) {
                const sources = ['certificate_requests', 'complaints', 'incidents', 'appointments', 'payment_transactions'];
                const results = await Promise.all(sources.map(collection => window.db.collection(collection).get()));
                const rows = results.flatMap((snapshot, index) => snapshot.docs.map(doc => ({
                    id: doc.id, requestType: sources[index], ...doc.data()
                })));
                renderRecordTable(page, rows);
                return;
            }
            let rows;
            try {
                rows = await loadRows(page);
            } catch (error) {
                console.error(`Unable to load ${page.title}:`, error);
                content.innerHTML = `<div class="content-header"><h1 class="page-title">${escapeBarangayHtml(page.title)}</h1></div><div class="stat-card">Unable to load records: ${escapeBarangayHtml(error.message)}</div>`;
                return;
            }
            if (page.id === 'residents') rows = rows.filter(row => row.role === 'resident');
            if (page.id === 'announcements' || page.id === 'resident_announcements') rows = rows.filter(row => row.status !== 'draft' && row.status !== 'archived');
            renderRecordTable(page, rows);
        }

        function renderRecordTable(page, rows) {
            const fields = page.fields || [];
            const addForm = fields.length ? `<form class="stat-card" id="brgyCreateForm"><h2 class="page-title" style="font-size:1.1rem">${escapeBarangayHtml(page.fixedRequestType ? 'Submit request' : `Add ${page.title.replace(/s$/, '')}`)}</h2><div class="register-grid">${fields.map(fieldControl).join('')}</div><button class="btn btn-primary" type="submit">${escapeBarangayHtml(page.fixedRequestType ? 'Submit request' : 'Save record')}</button></form>` : '';
            const exportButton = page.report ? '<button class="btn btn-secondary" type="button" id="brgyExportCsv">Export CSV</button>' : '';
            const columns = page.columns || [];
            const head = columns.map(key => `<th>${escapeBarangayHtml(key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()))}</th>`).join('');
            const search = '<div class="form-group"><input id="brgyRecordSearch" type="search" placeholder="Search records"></div>';
            const canUpdateStatus = page.statuses && role !== 'resident' && (page.id !== 'residents' || ['secretary', 'captain', 'superadmin'].includes(role));
            const table = `<div class="table-container"><table class="data-table"><thead><tr>${head}${canUpdateStatus ? '<th>Update status</th>' : ''}</tr></thead><tbody>${rows.length ? rows.map(row => `<tr data-record-id="${escapeBarangayHtml(row.id)}">${columns.map(key => `<td>${formatBarangayValue(row[key])}</td>`).join('')}${canUpdateStatus ? `<td><select class="brgy-status-select" aria-label="Update status">${page.statuses.map(status => `<option value="${status}" ${status === row.status ? 'selected' : ''}>${status.replace(/_/g, ' ')}</option>`).join('')}</select><button class="btn btn-primary brgy-save-status" type="button" data-id="${escapeBarangayHtml(row.id)}">Save</button></td>` : ''}</tr>`).join('') : `<tr><td colspan="${columns.length + (canUpdateStatus ? 1 : 0)}">No records found.</td></tr>`}</tbody></table></div>`;
            content.innerHTML = `<div class="content-header"><div><h1 class="page-title">${escapeBarangayHtml(page.title)}</h1><p class="page-subtitle">${role === 'resident' ? 'Your personal requests and updates.' : 'Barangay records available to your account.'}</p></div>${exportButton}</div>${addForm}${search}${table}`;
            const form = document.getElementById('brgyCreateForm');
            if (form) form.addEventListener('submit', async event => {
                event.preventDefault();
                const values = Object.fromEntries(new FormData(form).entries());
                const memberUserIds = page.collection === 'households'
                    ? String(values.memberUserIds || '').split(',').map(id => id.trim()).filter(Boolean)
                    : [];
                delete values.memberUserIds;
                const headOfHouseholdId = String(values.headOfHouseholdId || '').trim();
                if (headOfHouseholdId) memberUserIds.push(headOfHouseholdId);
                const uniqueMemberIds = [...new Set(memberUserIds)];
                let householdMembers = [];
                const record = { ...values, createdAt: new Date().toISOString(), status: 'pending' };
                if (role === 'resident' || ['patrol_logs', 'activity_logs', 'incidents'].includes(page.collection)) {
                    record.userId = user.uid;
                }
                if (['community_projects', 'households', 'announcements', 'meetings'].includes(page.collection)) {
                    record.createdBy = user.uid;
                }
                if (['income_records', 'expense_records', 'collection_records', 'blotter_records', 'meeting_minutes'].includes(page.collection)) {
                    record.recordedBy = user.uid;
                }
                if (page.collection === 'document_records') record.uploadedBy = user.uid;
                if (page.fixedRequestType) record.requestType = page.fixedRequestType;
                if (page.id === 'announcements') record.status = 'published';
                if (page.id === 'community_projects') record.status = 'planned';
                try {
                    if (page.collection === 'households' && uniqueMemberIds.length) {
                        householdMembers = await Promise.all(uniqueMemberIds.map(async id => {
                            const snapshot = await window.db.collection('users').doc(id).get();
                            const resident = snapshot.data();
                            if (!resident || resident.role !== 'resident') {
                                throw new Error(`Account ${id} is not an available resident.`);
                            }
                            if (resident.householdId) {
                                throw new Error(`${resident.name || resident.firstName} is already assigned to a household.`);
                            }
                            return { id, resident };
                        }));
                    }
                    const savedRecord = await window.db.collection(page.collection).add(record);
                    if (page.collection === 'households') {
                        const linkErrors = [];
                        for (const { id, resident } of householdMembers) {
                            const householdId = String(savedRecord.id);
                            try {
                                await window.db.collection('users').doc(id).update({ householdId });
                                await window.db.collection('household_members').add({
                                    householdId,
                                    userId: resident.users_id || id,
                                    fullName: resident.name || [resident.firstName, resident.middleName, resident.lastName, resident.suffix].filter(Boolean).join(' '),
                                    relationship: id === headOfHouseholdId ? 'Head of household' : 'Member',
                                    dateOfBirth: resident.dateOfBirth || null,
                                    sex: resident.sex || resident.gender || null
                                });
                            } catch (error) {
                                linkErrors.push(`${resident.name || id}: ${error.message}`);
                            }
                        }
                        if (linkErrors.length) {
                            console.error('Household saved with resident-link errors:', linkErrors);
                            window.showToast(`Household saved, but some residents could not be linked: ${linkErrors.join('; ')}`, 'error');
                            await setPage(page.id);
                            return;
                        }
                    }
                    window.showToast('Record saved.', 'success');
                    await setPage(page.id);
                } catch (error) {
                    console.error(`Could not create ${page.title} record:`, error);
                    window.showToast(`Could not save record: ${error.message}`, 'error');
                }
            });
            document.getElementById('brgyRecordSearch')?.addEventListener('input', event => {
                const query = event.target.value.toLowerCase();
                content.querySelectorAll('tbody tr').forEach(row => {
                    row.hidden = !row.textContent.toLowerCase().includes(query);
                });
            });
            content.querySelectorAll('.brgy-save-status').forEach(button => button.addEventListener('click', async () => {
                const row = button.closest('tr');
                const status = row.querySelector('.brgy-status-select').value;
                button.disabled = true;
                try {
                    if (page.collection === 'users') {
                        await window.db.collection(page.collection).doc(button.dataset.id).update({ status });
                    } else {
                        await window.db.collection(page.collection).doc(button.dataset.id).update({ status, reviewedBy: user.uid, reviewedAt: new Date().toISOString() });
                    }
                    window.showToast('Status updated.', 'success');
                    await setPage(page.id);
                } catch (error) {
                    console.error(`Could not update ${page.title} status:`, error);
                    window.showToast(`Could not update status: ${error.message}`, 'error');
                } finally {
                    button.disabled = false;
                }
            }));
            document.getElementById('brgyExportCsv')?.addEventListener('click', () => exportBarangayCsv(page, rows));
        }

        async function renderOfficialAccountForm(page) {
            const officialFields = [
                ['firstName', 'First name', 'text', true], ['middleName', 'Middle name', 'text'], ['lastName', 'Last name', 'text', true],
                ['suffix', 'Suffix', 'text'], ['sex', 'Sex', 'text', true], ['dateOfBirth', 'Date of birth', 'date'],
                ['birthplace', 'Birthplace', 'text'], ['houseNo', 'House number', 'text'], ['street', 'Street', 'text'],
                ['barangayNo', 'Barangay number', 'text'], ['city', 'City', 'text'], ['mobile', 'Phone number', 'tel', true],
                ['username', 'Desired username', 'text', true], ['email', 'Email', 'email', true], ['password', 'Password', 'password', true]
            ];
            const snapshot = await window.db.collection('users').get();
            const staff = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })).filter(item => item.role !== 'resident');
            content.innerHTML = `<div class="content-header"><div><h1 class="page-title">Officials &amp; Staff</h1><p class="page-subtitle">Create barangay official accounts and manage staff.</p></div></div>
                <form id="brgyOfficialForm" class="stat-card"><div class="register-grid">${officialFields.map(fieldControl).join('')}
                <div class="form-group"><label for="brgy-official-role">Official role</label><select id="brgy-official-role" name="role" required><option value="">Select role</option>${['kagawad','treasurer','secretary','tanod','captain',...(role === 'superadmin' ? ['superadmin'] : [])].map(option => `<option value="${option}">${option[0].toUpperCase()}${option.slice(1)}</option>`).join('')}</select></div>
                ${[['isPwd','PWD'],['isSoloParent','Solo parent'],['is4ps','4Ps member'],['registeredVoter','Registered voter']].map(([key,label]) => `<label class="terms-agreement"><input type="checkbox" name="${key}"> ${label}</label>`).join('')}
                <div class="form-group"><label for="brgy-official-voter">Voter ID number</label><input id="brgy-official-voter" name="voterIdNumber" type="text"></div>
                <button class="btn btn-primary" type="submit">Create official account</button></div></form>
                <div class="table-container"><table class="data-table"><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Email</th><th>Status</th></tr></thead><tbody>${staff.map(item => `<tr><td>${escapeBarangayHtml(item.name)}</td><td>${escapeBarangayHtml(item.username)}</td><td>${escapeBarangayHtml(item.role)}</td><td>${escapeBarangayHtml(item.email)}</td><td>${escapeBarangayHtml(item.status)}</td></tr>`).join('') || '<tr><td colspan="5">No officials found.</td></tr>'}</tbody></table></div>`;
            document.getElementById('brgyOfficialForm').addEventListener('submit', async event => {
                event.preventDefault();
                const form = event.currentTarget;
                const profile = Object.fromEntries(new FormData(form).entries());
                ['isPwd','isSoloParent','is4ps','registeredVoter'].forEach(key => { profile[key] = form.elements.namedItem(key).checked; });
                profile.name = [profile.firstName, profile.middleName, profile.lastName, profile.suffix].filter(Boolean).join(' ');
                if (profile.registeredVoter && !profile.voterIdNumber.trim()) return window.showToast('Voter ID number is required for registered voters.', 'error');
                try {
                    await window.auth.createAdminManagedUser(profile);
                    window.showToast('Official account created.', 'success');
                    await setPage(page.id);
                } catch (error) {
                    console.error('Official account creation failed:', error);
                    window.showToast(`Could not create official account: ${error.message}`, 'error');
                }
            });
        }

        function exportBarangayCsv(page, rows) {
            const columns = page.columns || [];
            const csv = [columns.join(','), ...rows.map(row => columns.map(key => `"${String(row[key] ?? '').replace(/"/g, '""')}"`).join(','))].join('\r\n');
            const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
            const link = document.createElement('a');
            link.href = url;
            link.download = `${page.id}-${new Date().toISOString().slice(0,10)}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        }

        document.querySelectorAll('.nav-item').forEach(item => item.addEventListener('click', event => {
            event.preventDefault();
            setPage(item.dataset.view).catch(error => {
                console.error('Could not open dashboard page:', error);
                window.showToast(`Could not open page: ${error.message}`, 'error');
            });
        }));
        const profileTrigger = document.getElementById('profileTrigger');
        const profileDropdown = document.getElementById('profileDropdown');
        profileTrigger?.addEventListener('click', event => {
            event.stopPropagation();
            const isOpen = profileDropdown?.classList.toggle('open') || false;
            profileTrigger.setAttribute('aria-expanded', String(isOpen));
        });
        document.addEventListener('click', event => {
            if (profileDropdown && !profileDropdown.contains(event.target)) {
                profileDropdown.classList.remove('open');
                profileTrigger?.setAttribute('aria-expanded', 'false');
            }
        });
        document.getElementById('viewProfileBtn')?.addEventListener('click', () => {
            profileDropdown?.classList.remove('open');
            profileTrigger?.setAttribute('aria-expanded', 'false');
            const profilePage = pages.find(page => page.profile || page.id === 'my_profile' || page.id === 'profile_settings');
            if (profilePage) setPage(profilePage.id);
        });
        document.getElementById('changePassBtn')?.addEventListener('click', () => {
            profileDropdown?.classList.remove('open');
            profileTrigger?.setAttribute('aria-expanded', 'false');
            if (typeof window.openPasswordModal === 'function') {
                window.openPasswordModal();
                return;
            }
            const settingsPage = pages.find(page => page.id === 'settings' || page.id === 'profile_settings' || page.id === 'my_profile');
            if (settingsPage) setPage(settingsPage.id);
        });
        document.getElementById('logoutBtn')?.addEventListener('click', async () => {
            try {
                const confirmed = await window.showConfirm({
                    title: 'Sign out',
                    message: 'Are you sure you want to sign out?',
                    confirmText: 'Sign out',
                    type: 'danger'
                });
                if (!confirmed) return;
                await window.auth.signOut();
                window.location.href = 'login.html';
            } catch (error) {
                console.error('Sign out failed:', error);
                window.showToast(`Could not sign out: ${error.message}`, 'error');
            }
        });
        document.getElementById('topbarToggle')?.addEventListener('click', () => {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            if (window.innerWidth < 1280) {
                sidebar?.classList.toggle('mobile-open');
                overlay?.classList.toggle('active');
            } else {
                sidebar?.classList.toggle('collapsed');
            }
        });
        document.getElementById('sidebarOverlay')?.addEventListener('click', () => {
            document.getElementById('sidebar')?.classList.remove('mobile-open');
            document.getElementById('sidebarOverlay')?.classList.remove('active');
        });
        document.getElementById('topbarSearchForm')?.addEventListener('submit', event => {
            event.preventDefault();
            const query = searchInput?.value.trim().toLowerCase() || '';
            const match = pages.find(page => page.title.toLowerCase().includes(query));
            if (match) setPage(match.id);
        });
        window.switchView = setPage;
        window.initializeNotificationDropdown?.(async () => {
            const snapshot = await window.db.collection('notifications').where('userId', '==', user.uid).get();
            return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), message: doc.data().body }));
        });
        setPage(currentPage.id).catch(error => {
            console.error('Barangay dashboard initialization failed:', error);
            content.innerHTML = `<div class="stat-card">Unable to load the dashboard: ${escapeBarangayHtml(error.message)}</div>`;
        });
    }

    window.normalizeBarangayRole = normalizeBarangayRole;
    window.initializeBarangayDashboard = initializeBarangayDashboard;

    function initRequiredAsterisks() {
        function updateIndicators() {
            const inputs = document.querySelectorAll('input, select, textarea');
            inputs.forEach(el => {
                if (el.type === 'hidden' || el.type === 'checkbox' || el.type === 'radio') return;

                let label = null;
                if (el.id) {
                    label = document.querySelector(`label[for="${el.id}"]`);
                }
                if (!label && el.closest) {
                    const wrapper = el.closest('.password-field, .input-wrapper');
                    if (wrapper && wrapper.previousElementSibling?.tagName === 'LABEL') {
                        label = wrapper.previousElementSibling;
                    }
                }
                if (!label && el.closest) {
                    const parent = el.closest('.form-group, .field, .input-group, .col-first, .col-last, .col-mi, .terms-agreement');
                    if (parent) {
                        label = parent.querySelector('label');
                    }
                }
                if (!label && el.previousElementSibling?.tagName === 'LABEL') {
                    label = el.previousElementSibling;
                }

                if (!label) return;

                const isRequired = el.hasAttribute('required') || el.required;
                let existingAsterisk = label.querySelector('.required-asterisk');

                if (isRequired) {
                    if (!existingAsterisk && !label.textContent.includes('*')) {
                        const span = document.createElement('span');
                        span.className = 'required-asterisk';
                        span.setAttribute('aria-hidden', 'true');
                        span.textContent = ' *';
                        label.appendChild(span);
                    } else if (existingAsterisk) {
                        existingAsterisk.style.display = 'inline';
                    }
                } else if (existingAsterisk) {
                    existingAsterisk.style.display = 'none';
                }
            });
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', updateIndicators);
        } else {
            updateIndicators();
        }

        let scheduled = false;
        const debouncedUpdate = () => {
            if (scheduled) return;
            scheduled = true;
            requestAnimationFrame(() => {
                updateIndicators();
                scheduled = false;
            });
        };

        const observer = new MutationObserver((mutations) => {
            let shouldUpdate = false;
            for (const m of mutations) {
                if (m.type === 'childList' && m.addedNodes.length > 0) {
                    shouldUpdate = true;
                    break;
                }
                if (m.type === 'attributes' && m.attributeName === 'required') {
                    shouldUpdate = true;
                    break;
                }
            }
            if (shouldUpdate) debouncedUpdate();
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['required']
        });

        return updateIndicators;
    }

    const updateRequiredAsterisks = initRequiredAsterisks();

    // Attach utilities to window
    window.resizeImage = resizeImage;
    window.getSecondaryAuth = getSecondaryAuth;
    window.showToast = showToast;
    window.showConfirm = showConfirm;
    window.initializeNotificationDropdown = initializeNotificationDropdown;
    window.formatDate = formatDate;
    window.getBorrowingActivityEvents = getBorrowingActivityEvents;
    window.escapeBorrowingHistoryHtml = escapeBorrowingHistoryHtml;
    window.getBorrowingDueAt = getBorrowingDueAt;
    window.isOverdueStrikeActive = isOverdueStrikeActive;
    window.formatTimeTo12h = formatTimeTo12h;
    window.capitalize = capitalize;
    window.getUserInitials = getUserInitials;
    window.checkAuth = checkAuth;
    window.updateRequiredAsterisks = updateRequiredAsterisks;

    // Page loader animation
    window.addEventListener('DOMContentLoaded', () => {
        const loader = document.getElementById('pageLoader');
        const content = document.getElementById('pageContent');

        if (loader) {
            loader.classList.add('fade-out');
            setTimeout(() => {
                loader.style.display = 'none';
            }, 500);
        }

        if (content) {
            content.classList.add('visible');
        }
    });

})(window);