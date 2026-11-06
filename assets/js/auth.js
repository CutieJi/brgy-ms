let isRegistering = false;
let isLoggingIn = false;
let registerTurnstileWidgetId = null;
let registerTurnstileToken = '';

function getDashboardForRole(userData) {
    const role = String(userData?.role || '').toLowerCase();
    if (['student', 'resident'].includes(role)) return 'resident.html';
    if (['admin', 'professor', 'kagawad', 'treasurer', 'secretary', 'tanod', 'captain', 'superadmin'].includes(role)) return 'admin.html';
    return null;
}

/**
 * Show an inline alert inside the form (above the email field).
 * @param {string} alertId   - 'loginAlert' or 'registerAlert'
 * @param {string} message   - The message to display
 * @param {'error'|'success'|'warning'} type
 */
function showFormAlert(alertId, message, type = 'error') {
    const el = document.getElementById(alertId);
    if (!el) return;

    const icons = {
        error: '&#10005;',
        success: '&#10003;',
        warning: '&#9888;'
    };

    el.innerHTML = `<span style="margin-right:7px;">${icons[type] || ''}</span>${message}`;
    el.className = `form-alert alert-${type}`;

    // Auto-clear success after 4s
    if (type === 'success') {
        setTimeout(() => clearFormAlert(alertId), 4000);
    }
}

function clearFormAlert(alertId) {
    const el = document.getElementById(alertId);
    if (el) {
        el.className = 'form-alert d-none';
        el.innerHTML = '';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // Check for real-time suspension lockout
    if (localStorage.getItem('mislend_suspended_lockout') === 'true') {
        showFormAlert('loginAlert', "Your account has been suspended. Please contact a barangay official.", "error");
        localStorage.removeItem('mislend_suspended_lockout');
    }

    auth.onAuthStateChanged(async (user) => {
        if (!user) return;
        if (isRegistering || isLoggingIn) return;

        try {
            const userDoc = await db.collection("users").doc(user.uid).get();
            const userData = userDoc.data();

            if (!userData) {
                await auth.signOut();
                return;
            }

            if (["student", "resident"].includes(userData.role)) {
                if (userData.status === "suspended") {
                    await auth.signOut();
                    showFormAlert('loginAlert', "Your account has been suspended. Please contact a barangay official.", "error");
                    return;
                }
                if (userData.status === "pending") {
                    await auth.signOut();
                    showFormAlert('loginAlert', "Your resident account is waiting for barangay approval.", "warning");
                    return;
                }
            }

            const dashboard = getDashboardForRole(userData);
            if (dashboard && (userData.status === "approved" || !["student", "resident"].includes(userData.role))) {
                window.location.href = dashboard;
            }

        } catch (err) {
            console.error("Index redirect error:", err);
        }
    });

    // ── LOGIN ────────────────────────────────────────────────────────────────
    const unifiedLoginForm = document.getElementById('unifiedLoginForm');

    if (unifiedLoginForm) {
        unifiedLoginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearFormAlert('loginAlert');

            const loginInput = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;
            const submitBtn = unifiedLoginForm.querySelector('button[type="submit"]');

            try {
                isLoggingIn = true;
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span>Signing in...</span>';

                const userCredential = await auth.signInWithEmailAndPassword(loginInput, password);
                const user = userCredential.user;

                const userDoc = await db.collection('users').doc(user.uid).get();
                const userData = userDoc.data();

                if (!userData) {
                    await auth.signOut();
                    throw new Error('User data not found. Please contact administrator.');
                }

                if (["student", "resident"].includes(userData.role)) {
                    if (userData.status === "suspended") {
                        await auth.signOut();
                        showFormAlert('loginAlert', "Your account has been suspended. Please contact a barangay official.", "error");
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = "<span>Sign In</span>";
                        isLoggingIn = false;
                        return;
                    }
                    if (userData.status === "pending") {
                        await auth.signOut();
                        showFormAlert('loginAlert', "Your resident account is waiting for barangay approval.", "warning");
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = "<span>Sign In</span>";
                        isLoggingIn = false;
                        return;
                    }
                }

                showFormAlert('loginAlert', 'Login successful! Redirecting...', 'success');

                setTimeout(() => {
                    const dashboard = getDashboardForRole(userData);
                    if (dashboard) window.location.href = dashboard;
                }, 1500);

            } catch (error) {
                isLoggingIn = false;
                console.error('Login error:', error);
                showFormAlert('loginAlert', getErrorMessage(error), 'error');

                submitBtn.disabled = false;
                submitBtn.innerHTML = `<span>Sign In</span>`;
            }
        });
    }

    // ── REGISTER ─────────────────────────────────────────────────────────────
    const registerForm = document.getElementById('unifiedRegisterForm');

    if (registerForm) {
        initializeRegistrationTurnstile();

        registerForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            clearFormAlert('registerAlert');

            const firstName = document.getElementById('registerFirstName').value.trim();
            const middleName = document.getElementById('registerMiddleName').value.trim();
            const lastName = document.getElementById('registerLastName').value.trim();
            const suffix = document.getElementById('registerSuffix').value.trim();
            const email = document.getElementById('registerEmail').value.trim();
            const username = document.getElementById('registerUsername').value.trim();
            const password = document.getElementById('registerPassword').value;
            const mobile = document.getElementById('registerMobile').value.trim();
            const voterIdNumber = document.getElementById('registerVoterId').value.trim();
            const registeredVoter = document.getElementById('registerRegisteredVoter').checked;
            const submitBtn = registerForm.querySelector('button[type="submit"]');
            const terms = document.getElementById('registerTerms');

            if (password.length < 6) {
                showFormAlert('registerAlert', 'Password must be at least 6 characters.', 'error');
                return;
            }
            if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username)) {
                showFormAlert('registerAlert', 'Username must be 3–30 characters and use letters, numbers, dots, underscores, or hyphens.', 'error');
                return;
            }
            if (!/^[0-9]{11}$/.test(mobile)) {
                showFormAlert('registerAlert', 'Mobile number must be exactly 11 digits.', 'error');
                return;
            }
            if (registeredVoter && !voterIdNumber) {
                showFormAlert('registerAlert', 'Enter your voter ID number if you are a registered voter.', 'error');
                return;
            }
            if (!terms.checked) {
                showFormAlert('registerAlert', 'Please agree to the Terms & Conditions and Privacy Policy.', 'error');
                return;
            }
            if (!registerTurnstileToken) {
                showFormAlert('registerAlert', 'Please complete the human verification check.', 'error');
                return;
            }

            try {
                isRegistering = true;
                submitBtn.disabled = true;
                submitBtn.innerHTML = '<span>Creating Account...</span>';

                const userData = {
                    name: [firstName, middleName, lastName, suffix].filter(Boolean).join(' '),
                    firstName,
                    middleName,
                    lastName,
                    suffix,
                    email,
                    username,
                    mobile,
                    role: 'resident',
                    status: 'pending',
                    sex: document.getElementById('registerSex').value,
                    dateOfBirth: document.getElementById('registerDateOfBirth').value,
                    birthplace: document.getElementById('registerBirthplace').value.trim(),
                    houseNo: document.getElementById('registerHouseNo').value.trim(),
                    street: document.getElementById('registerStreet').value.trim(),
                    barangayNo: document.getElementById('registerBarangayNo').value.trim(),
                    city: document.getElementById('registerCity').value.trim(),
                    isPwd: document.getElementById('registerPwd').checked,
                    isSoloParent: document.getElementById('registerSoloParent').checked,
                    is4ps: document.getElementById('register4ps').checked,
                    registeredVoter,
                    voterIdNumber: registeredVoter ? voterIdNumber : null,
                    createdAt: db.FieldValue.serverTimestamp()
                };

                await auth.createUserWithEmailAndPassword(email, password, userData, registerTurnstileToken);

                await auth.signOut();
                isRegistering = false;

                registerForm.reset();
                resetRegistrationTurnstile();
                showFormAlert('registerAlert', 'Resident account created! Wait for barangay approval before logging in.', 'success');

                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span>Create Account</span>';

            } catch (error) {
                isRegistering = false;
                console.error('Registration error:', error);
                showFormAlert('registerAlert', getErrorMessage(error), 'error');
                resetRegistrationTurnstile();

                submitBtn.disabled = false;
                submitBtn.innerHTML = '<span>Create Account</span>';
            }
        });
    }
});

async function initializeRegistrationTurnstile() {
    const container = document.getElementById('registerTurnstile');
    const status = document.getElementById('registerTurnstileStatus');
    const setStatus = message => {
        if (status) status.textContent = message;
    };
    if (!container) return;

    try {
        const config = await auth.getRegistrationTurnstileConfig();
        if (!config.siteKey) throw new Error('Human verification is not configured.');

        await loadTurnstileScript();
        registerTurnstileWidgetId = window.turnstile.render(container, {
            sitekey: config.siteKey,
            callback: token => {
                registerTurnstileToken = token;
                setStatus('');
            },
            'expired-callback': () => {
                registerTurnstileToken = '';
                setStatus('Verification expired. Please complete it again.');
            },
            'error-callback': () => {
                registerTurnstileToken = '';
                setStatus('Human verification could not load. Please refresh and try again.');
            }
        });
        setStatus('');
    } catch (error) {
        console.error('Could not initialize registration human verification:', error);
        setStatus(error.message || 'Human verification is unavailable. Please try again later.');
    }
}

function loadTurnstileScript() {
    if (window.turnstile) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const existingScript = document.querySelector('script[data-turnstile-api]');
        if (existingScript) {
            existingScript.addEventListener('load', resolve, { once: true });
            existingScript.addEventListener('error', () => reject(new Error('Cloudflare Turnstile failed to load.')), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.dataset.turnstileApi = 'true';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Cloudflare Turnstile failed to load.'));
        document.head.appendChild(script);
    });
}

function resetRegistrationTurnstile() {
    registerTurnstileToken = '';
    if (registerTurnstileWidgetId !== null && window.turnstile) {
        window.turnstile.reset(registerTurnstileWidgetId);
    }
}

function getErrorMessage(error) {
    const errorMessages = {
        'auth/email-already-in-use': 'This email is already registered.',
        'auth/invalid-email': 'Invalid email address.',
        'auth/weak-password': 'Password must be at least 6 characters.',
        'auth/user-not-found': 'Invalid username/email or password.',
        'auth/wrong-password': 'Invalid username/email or password.',
        'auth/invalid-credential': 'Invalid username/email or password.',
        'auth/too-many-requests': 'Too many failed attempts. Please try again later.'
    };

    return errorMessages[error.code] || error.message;
}