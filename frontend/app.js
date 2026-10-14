// ==============================================================================
// SCALER AI SCRIPT STUDIO - COMPLETE CLIENT LOGIC (ES6 - ZERO EMOJIS)
// ==============================================================================

const API_BASE = (typeof window !== "undefined" && window.location.origin && window.location.origin.startsWith("http"))
  ? `${window.location.origin}/api`
  : "http://127.0.0.1:8002/api";

// State
let currentScriptId = null;
let currentShareableUuid = null;
let currentOutlineCards = [];
let currentLoadedCards = [];
let currentLoadedScript = null;

// Users and Roles Governance State (PRD Users & Roles)
let allUsers = [];
let currentUser = null;
let allSystemPrograms = [];

// Initialize App
document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  setupEventListeners();
  await initUsersAndRoles();
});

// Theme Management (Light by Default, Switchable to Dark)
function initTheme() {
  const savedTheme = localStorage.getItem("scaler_theme_preference") || "light";
  applyTheme(savedTheme);
}

function applyTheme(theme) {
  const themeBtn = document.getElementById("themeToggleBtn");
  if (theme === "dark") {
    document.body.classList.remove("light-theme");
    document.body.classList.add("dark-theme");
    if (themeBtn) themeBtn.textContent = "Switch to Light";
    if (window.mermaid) {
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose"
      });
    }
  } else {
    document.body.classList.remove("dark-theme");
    document.body.classList.add("light-theme");
    if (themeBtn) themeBtn.textContent = "Switch to Dark";
    if (window.mermaid) {
      mermaid.initialize({
        startOnLoad: false,
        theme: "default",
        securityLevel: "loose"
      });
    }
  }
  localStorage.setItem("scaler_theme_preference", theme);
}

function toggleTheme() {
  const isDark = document.body.classList.contains("dark-theme");
  applyTheme(isDark ? "light" : "dark");
}

// Universal Loader Helper
function showLoader(message = "AI Multi-Agent Collaboration in Progress...") {
  const loader = document.getElementById("universalLoader");
  const msg = document.getElementById("loaderMessage");
  if (msg) msg.textContent = message;
  if (loader) loader.classList.remove("hidden");
}

function hideLoader() {
  const loader = document.getElementById("universalLoader");
  if (loader) loader.classList.add("hidden");
}

// Event Listeners
function setupEventListeners() {
  // Theme Toggle (Upper One Working for All)
  const themeBtn = document.getElementById("themeToggleBtn");
  if (themeBtn) {
    themeBtn.onclick = toggleTheme;
  }

  // Cascading Selectors
  document.getElementById("programSelect").addEventListener("change", onProgramChange);
  document.getElementById("trackSelect").addEventListener("change", onTrackChange);
  document.getElementById("moduleSelect").addEventListener("change", onModuleChange);
  document.getElementById("classSelect").addEventListener("change", onClassChange);

  // Sliders
  const mixSlider = document.getElementById("mixSlider");
  const mixVal = document.getElementById("mixVal");
  mixSlider.addEventListener("input", (e) => {
    mixVal.textContent = `${e.target.value}% Beg / ${100 - e.target.value}% Adv`;
  });

  const codeSlider = document.getElementById("codeRatioSlider");
  const codeVal = document.getElementById("codeRatioVal");
  codeSlider.addEventListener("input", (e) => {
    codeVal.textContent = `${e.target.value}% Code / ${100 - e.target.value}% Theory`;
  });

  const durationSelect = document.getElementById("durationSelect");
  const customDurationInput = document.getElementById("customDurationInput");
  const durationVal = document.getElementById("durationVal");

  if (durationSelect) {
    durationSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val) {
        if (durationVal) durationVal.textContent = `${val} mins`;
        if (customDurationInput) customDurationInput.value = val;
      } else {
        if (durationVal) durationVal.textContent = "Select duration";
        if (customDurationInput) customDurationInput.value = "";
      }
    });
  }

  // Prev Script File Upload
  const prevFileInput = document.getElementById("prevScriptFileInput");
  if (prevFileInput) {
    prevFileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          const up = document.getElementById("prevScriptUpload");
          if (up) up.value = evt.target.result;
        };
        reader.readAsText(file);
      }
    });
  }

  // Action Buttons
  document.getElementById("initScriptBtn")?.addEventListener("click", onInitScript);
  document.getElementById("outlineGtgBtn")?.addEventListener("click", onOutlineGtg);
  document.getElementById("outlineRethinkBtn")?.addEventListener("click", onOutlineRethink);
  document.getElementById("draftAllBtn")?.addEventListener("click", onDraftAllRemaining);
  document.getElementById("exportMdBtn")?.addEventListener("click", onExportMarkdown);
  document.getElementById("assignmentsBtn")?.addEventListener("click", onGenerateAssignments);
  document.getElementById("runReviewBtn")?.addEventListener("click", onRunReview);
  document.getElementById("moGtgBtn")?.addEventListener("click", onMoSignOff);
  document.getElementById("shareLinkBtn")?.addEventListener("click", onShareLink);

  // Modal Closers
  document.getElementById("closeEditModalBtn").addEventListener("click", () => {
    document.getElementById("cardEditModal").classList.add("hidden");
  });
  document.getElementById("closeChatModalBtn").addEventListener("click", () => {
    document.getElementById("chatAssistModal").classList.add("hidden");
  });
  document.getElementById("closeAssignmentsModalBtn").addEventListener("click", () => {
    document.getElementById("assignmentsModal").classList.add("hidden");
  });

  // Role Workspace Switcher (PRD Users & Roles)
  const roleSelect = document.getElementById("activeRoleSelector");
  if (roleSelect) roleSelect.addEventListener("change", onRoleChange);

  // MO Dashboard Listeners
  const moScopeFilter = document.getElementById("moScopeProgramFilter");
  if (moScopeFilter) moScopeFilter.addEventListener("change", loadMoDashboardData);
  const refreshMoDashBtn = document.getElementById("refreshMoDashboardBtn");
  if (refreshMoDashBtn) refreshMoDashBtn.addEventListener("click", loadMoDashboardData);

  // PM Dashboard Listeners
  const pmProgFilter = document.getElementById("pmProgramFilterSelect");
  if (pmProgFilter) pmProgFilter.addEventListener("change", loadPmDashboardData);
  const pmSearchInput = document.getElementById("pmClassSearchInput");
  if (pmSearchInput) pmSearchInput.addEventListener("input", filterPmCoverageTable);
  const refreshPmDashBtn = document.getElementById("refreshPmDashboardBtn");
  if (refreshPmDashBtn) refreshPmDashBtn.addEventListener("click", loadPmDashboardData);

  // Admin Dashboard Listeners
  const refreshAdminDashBtn = document.getElementById("refreshAdminDashboardBtn");
  if (refreshAdminDashBtn) refreshAdminDashBtn.addEventListener("click", loadAdminDashboardData);

  // Modal Submissions
  document.getElementById("saveCardEditBtn").addEventListener("click", onSaveCardEdit);
  document.getElementById("submitChatAssistBtn").addEventListener("click", onSubmitChatAssist);

  // MO Curriculum Modal Listeners
  const saveMoClassBtn = document.getElementById("saveMoClassBtn");
  if (saveMoClassBtn) saveMoClassBtn.addEventListener("click", onSaveMoClass);
  const deleteMoClassBtn = document.getElementById("deleteMoClassBtn");
  if (deleteMoClassBtn) deleteMoClassBtn.addEventListener("click", onDeleteMoClass);
  const closeMoEditClassBtn = document.getElementById("closeMoEditClassBtn");
  if (closeMoEditClassBtn) closeMoEditClassBtn.addEventListener("click", () => {
    document.getElementById("moEditClassModal").classList.add("hidden");
  });
  const closeMoModalBtn = document.getElementById("closeMoModalBtn");
  if (closeMoModalBtn) closeMoModalBtn.addEventListener("click", () => {
    document.getElementById("moCurriculumModal").classList.add("hidden");
  });

  // User Management Modal Listeners
  const saveUserBtn = document.getElementById("saveUserBtn");
  if (saveUserBtn) saveUserBtn.addEventListener("click", onSaveUser);
  const closeUserModalBtn = document.getElementById("closeUserManageModalBtn");
  if (closeUserModalBtn) closeUserModalBtn.addEventListener("click", () => {
    document.getElementById("userManageModal").classList.add("hidden");
  });
  const cancelUserBtn = document.getElementById("cancelUserManageBtn");
  if (cancelUserBtn) cancelUserBtn.addEventListener("click", () => {
    document.getElementById("userManageModal").classList.add("hidden");
  });

  // Close profile dropdown on outside click
  document.addEventListener("click", (e) => {
    const menu = document.getElementById("userProfileDropdown");
    const btn = document.getElementById("userProfileBtn");
    if (menu && !menu.classList.contains("hidden")) {
      if (!menu.contains(e.target) && !btn?.contains(e.target)) {
        menu.classList.add("hidden");
      }
    }
  });
}

// ==============================================================================
// 0. USERS AND ROLES GOVERNANCE ENGINE (PRD USERS & ROLES)
// ==============================================================================

function getRoleLabel(role) {
  switch (role) {
    case "sme": return "SME / Author";
    case "mo": return "Module Owner (MO)";
    case "pm": return "Program Manager (PM)";
    case "admin": return "Admin";
    default: return role;
  }
}

function getInitials(name) {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function renderUserProfileMenu(user) {
  if (!user) return;

  const initials = getInitials(user.name);
  const roleLabel = getRoleLabel(user.role);

  // Update Navbar profile pill
  const avatarCircle = document.getElementById("userAvatarCircle");
  if (avatarCircle) avatarCircle.textContent = initials;

  const displayName = document.getElementById("userDisplayName");
  if (displayName) displayName.textContent = user.name;

  const roleBadge = document.getElementById("userRoleBadge");
  if (roleBadge) roleBadge.textContent = roleLabel;

  // Update Dropdown header
  const dropAvatar = document.getElementById("dropdownAvatarCircle");
  if (dropAvatar) dropAvatar.textContent = initials;

  const dropName = document.getElementById("dropdownUserName");
  if (dropName) dropName.textContent = user.name;

  const dropEmail = document.getElementById("dropdownUserEmail");
  if (dropEmail) dropEmail.textContent = user.email || "";

  const dropRole = document.getElementById("dropdownRoleBadge");
  if (dropRole) dropRole.textContent = roleLabel;

  // Render profiles switch list
  const list = document.getElementById("profileSelectList");
  if (list && allUsers.length > 0) {
    list.innerHTML = "";
    allUsers.forEach(u => {
      const isActive = u.id === user.id;
      const uInitials = getInitials(u.name);
      const uRole = getRoleLabel(u.role);
      list.innerHTML += `
        <div class="profile-select-item ${isActive ? 'active' : ''}" onclick="selectUserProfile(${u.id})">
          <div class="user-avatar-circle small">${uInitials}</div>
          <div class="profile-item-text">
            <div class="profile-item-name">${escapeHtml(u.name)}</div>
            <div class="profile-item-role">${uRole}</div>
          </div>
        </div>
      `;
    });
  }
}

function toggleUserProfileMenu() {
  const menu = document.getElementById("userProfileDropdown");
  if (menu) {
    menu.classList.toggle("hidden");
  }
}

window.toggleUserProfileMenu = toggleUserProfileMenu;

async function selectUserProfile(userId) {
  const menu = document.getElementById("userProfileDropdown");
  if (menu) menu.classList.add("hidden");
  await switchActiveUser(userId, true);
}

window.selectUserProfile = selectUserProfile;

function switchWorkspaceRole(role) {
  const menu = document.getElementById("userProfileDropdown");
  if (menu) menu.classList.add("hidden");
  const roleSelect = document.getElementById("activeRoleSelector");
  if (roleSelect) roleSelect.value = role;
  onRoleChange({ target: { value: role } });
}

window.switchWorkspaceRole = switchWorkspaceRole;

function signOutCurrentUser() {
  localStorage.removeItem("scaler_active_user_id");
  currentUser = null;
  currentScriptId = null;
  currentShareableUuid = null;
  currentSelectedProgramId = null;
  const input = document.getElementById("companyMailInput");
  if (input) input.value = "";
  const errorBox = document.getElementById("companyMailError");
  if (errorBox) errorBox.classList.add("hidden");
  showHomeDashboard();
}

window.signOutCurrentUser = signOutCurrentUser;

function showHomeDashboard() {
  // Hide all other dashboard views
  document.querySelectorAll(".dashboard-view").forEach(v => {
    v.classList.remove("active");
    v.classList.add("hidden");
  });

  const homeView = document.getElementById("homeDashboardView");
  if (homeView) {
    homeView.classList.remove("hidden");
    homeView.classList.add("active");
  }

  // Hide sign-out button on home login screen
  const signOutBtn = document.getElementById("signOutBtn");
  if (signOutBtn) signOutBtn.classList.add("hidden");

  // Ensure header is visible
  const header = document.querySelector(".app-header");
  if (header) header.classList.remove("hidden");

  window.scrollTo(0, 0);
}

window.showHomeDashboard = showHomeDashboard;

function returnToActiveWorkspace() {
  if (currentUser) {
    const homeView = document.getElementById("homeDashboardView");
    if (homeView) {
      homeView.classList.add("hidden");
      homeView.classList.remove("active");
    }
    const signOutBtn = document.getElementById("signOutBtn");
    if (signOutBtn) signOutBtn.classList.remove("hidden");

    onRoleChange({ target: { value: currentUser.role } });
    if (currentUser.role === "sme") {
      showSmeLandingView();
    }
  } else {
    showHomeDashboard();
  }
}

window.returnToActiveWorkspace = returnToActiveWorkspace;

async function submitScalerCompanyLogin() {
  console.log("submitScalerCompanyLogin called");
  const input = document.getElementById("companyMailInput");
  const errorBox = document.getElementById("companyMailError");
  if (!input) {
    alert("Login input element 'companyMailInput' not found!");
    return;
  }
  const email = input.value.trim().toLowerCase();
  console.log("Logging in with email:", email);

  if (!email || !email.includes("@")) {
    const msg = "Please enter a valid company email address.";
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.classList.remove("hidden");
    }
    alert(msg);
    input.focus();
    return;
  }

  try {
    showLoader("Verifying Scaler Company Email...");
    console.log("Fetching users from:", `${API_BASE}/users`);
    const res = await fetch(`${API_BASE}/users`);
    if (!res.ok) throw new Error(`Could not connect to backend server (${res.status}).`);
    allUsers = await res.json();
    console.log("Loaded users:", allUsers);
    const targetUser = allUsers.find(u => (u.email || "").trim().toLowerCase() === email);

    if (targetUser) {
      console.log("Target user found:", targetUser);
      if (errorBox) errorBox.classList.add("hidden");
      localStorage.setItem("scaler_active_user_id", targetUser.id);
      currentUser = targetUser;
      
      // Explicitly switch views
      const homeView = document.getElementById("homeDashboardView");
      if (homeView) {
        homeView.classList.add("hidden");
        homeView.classList.remove("active");
      }

      await switchActiveUser(targetUser.id, true);
      recordClientActivity("User Sign-In", `Signed into ${targetUser.role.toUpperCase()} portal`);
      console.log("Login transition complete for:", targetUser.name);
    } else {
      const msg = `No account found for '${email}'. Please verify the email address or ask your Administrator to register it.`;
      console.warn(msg);
      if (errorBox) {
        errorBox.textContent = msg;
        errorBox.classList.remove("hidden");
      }
      alert(msg);
    }
  } catch (err) {
    console.error("Error authenticating Scaler email:", err);
    const msg = "Error connecting to server: " + err.message;
    if (errorBox) {
      errorBox.textContent = msg;
      errorBox.classList.remove("hidden");
    }
    alert(msg);
  } finally {
    hideLoader();
  }
}

window.submitScalerCompanyLogin = submitScalerCompanyLogin;

function quickFillScalerLogin(email) {
  const input = document.getElementById("companyMailInput");
  if (input) input.value = email;
  submitScalerCompanyLogin();
}

window.quickFillScalerLogin = quickFillScalerLogin;

async function initUsersAndRoles() {
  try {
    const [pRes, uRes] = await Promise.all([
      fetch(`${API_BASE}/programs`),
      fetch(`${API_BASE}/users`)
    ]);
    allSystemPrograms = await pRes.json();
    allUsers = await uRes.json();

    const userSelect = document.getElementById("activeUserSelector");
    if (userSelect) {
      userSelect.innerHTML = "";
      allUsers.forEach(u => {
        userSelect.innerHTML += `<option value="${u.id}">${escapeHtml(u.name)} (${getRoleLabel(u.role)})</option>`;
      });
      userSelect.addEventListener("change", (e) => {
        switchActiveUser(parseInt(e.target.value, 10));
      });
    }

    const savedId = localStorage.getItem("scaler_active_user_id");
    if (savedId) {
      const savedIdInt = parseInt(savedId, 10);
      // Verify the saved user still exists in the DB (admin may have deleted them)
      const stillExists = allUsers.find(u => u.id === savedIdInt);
      if (stillExists) {
        await switchActiveUser(savedIdInt, true);
      } else {
        // User was deleted — clear stale session and show login
        localStorage.removeItem("scaler_active_user_id");
        showHomeDashboard();
      }
    } else {
      showHomeDashboard();
    }
  } catch (err) {
    console.error("Error initializing users:", err);
    showHomeDashboard();
  }
}

async function switchActiveUser(userId, autoSwitchWorkspace = true) {
  const user = allUsers.find(u => u.id === userId) || allUsers[0];
  if (!user) return;
  currentUser = user;
  localStorage.setItem("scaler_active_user_id", user.id);

  const userSelect = document.getElementById("activeUserSelector");
  if (userSelect) userSelect.value = user.id;

  // Update Scope Badge
  const scopeBadge = document.getElementById("userScopeBadge");
  if (scopeBadge) {
    scopeBadge.className = `scope-badge scope-${user.role}`;
    if (user.role === "sme") {
      scopeBadge.textContent = `Scope: Programs Joined (${user.program_names.length})`;
      scopeBadge.title = `Joined Programs: ${user.program_names.join(", ")}`;
    } else if (user.role === "mo") {
      scopeBadge.textContent = `Scope: Programs Part Of (${user.program_names.length})`;
      scopeBadge.title = `Assigned Programs: ${user.program_names.join(", ")}`;
    } else if (user.role === "pm") {
      scopeBadge.textContent = "Scope: All 5 Programs (LO Team - Read-Only)";
      scopeBadge.title = "Views status, content, module names, class names and agendas with no edit access across all programs";
    } else if (user.role === "admin") {
      scopeBadge.textContent = "Scope: All Programs (Full Control)";
      scopeBadge.title = "Global management of programs, tracks, levels, users and module structure";
    }
  }

  // Update Production Profile Menu in Navbar
  renderUserProfileMenu(user);

  const signOutBtn = document.getElementById("signOutBtn");
  if (signOutBtn) signOutBtn.classList.remove("hidden");

  // Always hide home portal when user is activated
  const homeView = document.getElementById("homeDashboardView");
  if (homeView) {
    homeView.classList.add("hidden");
    homeView.classList.remove("active");
  }

  // Automatically switch workspace to the user's role
  const roleSelect = document.getElementById("activeRoleSelector");
  if (roleSelect && autoSwitchWorkspace) {
    roleSelect.value = user.role;
    onRoleChange({ target: { value: user.role } });
  }

  // If user is SME, ALWAYS present the Enrolled Programs Card landing screen as the FIRST screen
  // with production navbar showing their profile only
  const appHeader = document.querySelector(".app-header");
  if (user.role === "sme") {
    if (appHeader) appHeader.classList.remove("hidden");
    showSmeLandingView();
    await renderSmeProgramCards(user);
  } else {
    if (appHeader) appHeader.classList.remove("hidden");
    const landing = document.getElementById("smeProgramsLandingView");
    const studio = document.getElementById("smeAuthoringStudioLayout");
    if (landing) landing.classList.add("hidden");
    if (studio) studio.classList.remove("hidden");
  }

  // Reload cascading programs for SME (filtered to user's joined programs)
  await loadPrograms(user.id);
}

// Render SME Enrolled Programs as Cards (First Screen After Login)
async function renderSmeProgramCards(user = null) {
  const targetUser = user || currentUser;
  const grid = document.getElementById("smeEnrolledProgramsGrid");
  if (!grid) return;

  if (!targetUser) {
    grid.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">No user logged in.</div>';
    return;
  }

  try {
    grid.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">Loading your enrolled programs...</div>';

    // Fetch programs and authored scripts scoped strictly to this SME
    const [progRes, scriptRes] = await Promise.all([
      fetch(`${API_BASE}/programs?user_id=${targetUser.id}`),
      fetch(`${API_BASE}/dashboard/scripts?user_id=${targetUser.id}`)
    ]);
    const enrolledPrograms = await progRes.json();
    const allScripts = await scriptRes.json();

    if (!enrolledPrograms || enrolledPrograms.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; background: var(--bg-card); padding: 32px; border-radius: 8px; border: 1px dashed var(--border-subtle); text-align: center;">
          <h3 style="font-size: 1.1rem; color: var(--text-primary); margin-bottom: 8px;">No Programs Enrolled</h3>
          <p style="font-size: 0.88rem; color: var(--text-secondary); max-width: 500px; margin: 0 auto 16px auto;">
            You are not currently enrolled in any curriculum programs. Please ask your Administrator to enroll your email (${escapeHtml(targetUser.email)}) in curriculum programs.
          </p>
        </div>
      `;
      return;
    }

    let cardsHtml = "";
    enrolledPrograms.forEach(prog => {
      const progScripts = (allScripts || []).filter(s => s.program_id === prog.id);
      const approvedScripts = progScripts.filter(s => s.status === "GTG");
      const approvedCount = approvedScripts.length;
      const totalCount = progScripts.length;

      cardsHtml += `
        <div class="program-card-item" onclick="selectSmeProgramCard(${prog.id}, '${escapeHtml(prog.name)}')">
          <div class="program-card-title-wrap" style="margin-bottom: 20px;">
            <div>
              <h2 class="program-card-heading">${escapeHtml(prog.name)}</h2>
              <div style="font-size:0.86rem; color:var(--text-secondary); margin-top:8px;">
                ${totalCount > 0 ? `${totalCount} Scripts Generated &bull; <span style="color:var(--success-color); font-weight:600;">${approvedCount} GTG Approved</span>` : 'No scripts generated yet'}
              </div>
            </div>
          </div>
          <button class="program-card-action-btn" onclick="event.stopPropagation(); selectSmeProgramCard(${prog.id}, '${escapeHtml(prog.name)}')">
            <span>Launch Script Studio</span>
            <span class="program-card-arrow">&rarr;</span>
          </button>
        </div>
      `;
    });

    grid.innerHTML = cardsHtml;
  } catch (err) {
    grid.innerHTML = `<div style="color:var(--danger-color); padding:20px;">Error loading enrolled programs: ${err.message}</div>`;
  }
}

function showSmeLandingView() {
  const landing = document.getElementById("smeProgramsLandingView");
  const studio = document.getElementById("smeAuthoringStudioLayout");
  const header = document.querySelector(".app-header");
  if (landing) landing.classList.remove("hidden");
  if (studio) studio.classList.add("hidden");
  if (header) header.classList.remove("hidden");
  document.getElementById("outlineGate")?.classList.add("hidden");
  document.getElementById("studioView")?.classList.add("hidden");
  renderSmeProgramCards(currentUser);
}

window.showSmeLandingView = showSmeLandingView;

// Stub for SME authored scripts refresh — called on workspace switch and after GTG approval
async function loadSmeAuthoredScripts() {
  if (!currentUser || currentUser.role !== "sme") return;
  if (currentSelectedProgramId) {
    const progSel = document.getElementById("programSelect");
    const pName = progSel?.selectedOptions[0]?.text || "";
    await renderProgramScriptsTable(currentSelectedProgramId, pName);
  }
}
window.loadSmeAuthoredScripts = loadSmeAuthoredScripts;

// Track active program in SME Studio
let currentSelectedProgramId = null;

// View switcher for SME Studio: 'generator' | 'scripts' | 'outline' | 'script'
window.switchSmeStudioView = function (view) {
  const inputsView = document.getElementById("smeInputsView");
  const scriptsView = document.getElementById("smeScriptsDedicatedView");
  const outlineGate = document.getElementById("outlineGate");
  const studioView = document.getElementById("studioView");
  const tabScriptsBtn = document.getElementById("smeTabScriptsBtn");

  if (view === "scripts") {
    // Show only Program Scripts in full screen
    if (inputsView) inputsView.classList.add("hidden");
    if (outlineGate) outlineGate.classList.add("hidden");
    if (studioView) studioView.classList.add("hidden");
    if (scriptsView) scriptsView.classList.remove("hidden");
    if (tabScriptsBtn) tabScriptsBtn.classList.add("active");
    refreshCurrentProgramScripts();
    recordClientActivity("Tab Switched", "Opened SME Program Scripts view");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (view === "generator") {
    // Show only generator inputs in full screen
    if (scriptsView) scriptsView.classList.add("hidden");
    if (outlineGate) outlineGate.classList.add("hidden");
    if (studioView) studioView.classList.add("hidden");
    if (inputsView) inputsView.classList.remove("hidden");
    if (tabScriptsBtn) tabScriptsBtn.classList.remove("active");
    recordClientActivity("Tab Switched", "Switched to SME Script Generator Input view");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (view === "outline") {
    // Show only outline gate in full screen
    if (inputsView) inputsView.classList.add("hidden");
    if (scriptsView) scriptsView.classList.add("hidden");
    if (studioView) studioView.classList.add("hidden");
    if (outlineGate) outlineGate.classList.remove("hidden");
    if (tabScriptsBtn) tabScriptsBtn.classList.remove("active");
    recordClientActivity("Tab Switched", "Opened Outline Review Gate");
    window.scrollTo({ top: 0, behavior: "smooth" });
  } else if (view === "script") {
    // Show only script studio teleprompter deck in full screen
    if (inputsView) inputsView.classList.add("hidden");
    if (scriptsView) scriptsView.classList.add("hidden");
    if (outlineGate) outlineGate.classList.add("hidden");
    if (studioView) studioView.classList.remove("hidden");
    if (tabScriptsBtn) tabScriptsBtn.classList.remove("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
};

// Share script link helper with clipboard copying
window.shareScriptLink = function (scriptId, evt) {
  if (evt) evt.stopPropagation();
  const url = window.location.origin + '/?script=' + scriptId;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      alert("Script share link copied to clipboard!\n" + url);
    }).catch(() => {
      prompt("Copy script link:", url);
    });
  } else {
    prompt("Copy script link:", url);
  }
};

// Open existing script directly in SME studio (ONLY shows the script, hides inputs)
window.loadExistingScriptIntoStudio = async function (scriptId) {
  currentScriptId = scriptId;
  const landing = document.getElementById("smeProgramsLandingView");
  const studio = document.getElementById("smeAuthoringStudioLayout");
  const modal = document.getElementById("assignmentsModal");
  if (modal) modal.classList.add("hidden");
  if (landing) landing.classList.add("hidden");
  if (studio) studio.classList.remove("hidden");

  // Switch to dedicated full-width script view - hiding generator inputs!
  switchSmeStudioView("script");

  document.getElementById("emptyState")?.classList.add("hidden");
  document.getElementById("outlineGate")?.classList.add("hidden");

  await loadScriptStudioView();
  const studioView = document.getElementById("studioView");
  if (studioView) {
    studioView.classList.remove("hidden");
    studioView.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};

// Render scripts in the top-right Scripts dropdown table
async function renderProgramScriptsTable(progId, progName = "") {
  const tbody = document.getElementById("smeProgramScriptsTableBody");
  const titleEl = document.getElementById("smeProgramScriptsTitle");
  const badgeEl = document.getElementById("smeProgramScriptsCountBadge");
  const tabBadgeEl = document.getElementById("smeStudioTabScriptsBadge");
  const subtitleEl = document.getElementById("smeProgramScriptsSubtitle");
  if (!tbody) return;

  const resolvedName = progName || (allSystemPrograms.find(p => p.id === parseInt(progId, 10))?.name) || `Program #${progId}`;

  if (titleEl) {
    titleEl.textContent = `Program Scripts`;
  }
  if (subtitleEl) {
    subtitleEl.textContent = `All lesson scripts generated for ${resolvedName}.`;
  }

  try {
    const userParam = (currentUser && currentUser.role === "sme") ? `&user_id=${currentUser.id}` : "";
    const res = await fetch(`${API_BASE}/dashboard/scripts?program_id=${progId}${userParam}`);
    if (!res.ok) return;
    const scripts = await res.json();

    const approvedCount = (scripts || []).filter(s => s.status === "GTG").length;
    const totalCount = (scripts || []).length;

    if (badgeEl) {
      badgeEl.textContent = `${approvedCount} GTG Approved / ${totalCount} Total`;
      badgeEl.className = approvedCount > 0 ? "status-pill status-gtg" : "status-pill status-idle";
    }
    if (tabBadgeEl) {
      tabBadgeEl.textContent = totalCount;
    }
    const navBadge = document.getElementById("smeProgramScriptsNavBadge");
    if (navBadge) {
      navBadge.textContent = totalCount;
    }
    const headerBadge = document.getElementById("headerScriptsBadge");
    if (headerBadge) {
      headerBadge.textContent = totalCount;
    }
    const emptyBadge = document.getElementById("emptyStateScriptsBadge");
    if (emptyBadge) {
      emptyBadge.textContent = totalCount;
    }

    if (!scripts || scripts.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; color: var(--text-secondary); padding: 22px;">
            No scripts generated yet for ${escapeHtml(resolvedName)}. Use the generator on the left to create your first lesson script.
          </td>
        </tr>
      `;
      return;
    }

    let rowsHtml = "";
    scripts.forEach(s => {
      const isApproved = (s.status === "GTG");
      const statusClass = isApproved ? "status-gtg" : (s.status === "Script WIP" ? "status-wip" : "status-idle");
      const statusLabel = isApproved ? "Official GTG Approved" : (s.status || "Pending MO Sign-Off");

      rowsHtml += `
        <tr id="sme-prog-script-row-${s.id}">
          <td style="font-weight: 600; padding: 10px 12px; border-bottom: 1px solid var(--border-subtle);">${escapeHtml(s.class_title)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); font-size: 0.8rem; color: var(--text-secondary);"><span style="background: rgba(37,99,235,0.08); color: var(--primary-color); padding: 3px 8px; border-radius: 4px; font-weight: 600;">${escapeHtml(s.track_name || 'Standard')}</span></td>
          <td style="padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(s.module_name)}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid var(--border-subtle);"><span class="status-pill ${statusClass}" style="font-size:0.75rem;">${statusLabel}</span></td>
          <td style="padding: 10px 12px; border-bottom: 1px solid var(--border-subtle); text-align: right; white-space: nowrap;">
            <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 0.78rem; margin-right: 4px;" onclick="shareScriptLink(${s.id}, event)">Share</button>
            <button class="btn btn-primary" style="padding: 4px 12px; font-size: 0.78rem; margin-right: 4px;" onclick="loadExistingScriptIntoStudio(${s.id})">Open</button>
            <button class="btn btn-warning" style="padding: 4px 8px; font-size: 0.78rem; background:rgba(239,68,68,0.12); color:var(--danger-color); border:1px solid rgba(239,68,68,0.3);" onclick="deleteScriptDirectly(${s.id}, '${escapeHtml(s.class_title)}')">Delete</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = rowsHtml;
  } catch (err) {
    console.error("Error loading program scripts:", err);
  }
}

window.renderProgramScriptsTable = renderProgramScriptsTable;

window.refreshCurrentProgramScripts = function () {
  if (currentSelectedProgramId) {
    const progSel = document.getElementById("programSelect");
    const pName = progSel?.selectedOptions[0]?.text || "Selected Program";
    renderProgramScriptsTable(currentSelectedProgramId, pName);
  }
};

async function selectSmeProgramCard(progId, progName = "") {
  currentSelectedProgramId = progId;
  const landing = document.getElementById("smeProgramsLandingView");
  const studio = document.getElementById("smeAuthoringStudioLayout");
  const header = document.querySelector(".app-header");
  if (landing) landing.classList.add("hidden");
  if (studio) studio.classList.remove("hidden");
  if (header) header.classList.remove("hidden");

  // Activate the clean generator view
  switchSmeStudioView("generator");
  document.getElementById("smeInputsContainer")?.classList.remove("hidden");
  document.getElementById("emptyState")?.classList.add("hidden");
  
  // Reset any active gates or studio views from previously opened scripts
  document.getElementById("outlineGate")?.classList.add("hidden");
  document.getElementById("studioView")?.classList.add("hidden");
  window.scrollTo({ top: 0, behavior: "instant" });

  // Update breadcrumb
  const pName = progName || (allSystemPrograms.find(p => p.id === progId)?.name) || "Program #" + progId;
  const breadcrumb = document.getElementById("smeSelectedProgramBreadcrumb");
  if (breadcrumb) {
    breadcrumb.textContent = `Program: ${pName}`;
  }

  // Pre-select program dropdown and auto-cascade inputs
  const progSel = document.getElementById("programSelect");
  if (progSel) {
    progSel.value = progId;
    await onProgramChange({ target: { value: progId } });
  }

  // Populate program scripts count in badge
  await renderProgramScriptsTable(progId, pName);
}

window.selectSmeProgramCard = selectSmeProgramCard;

// ==============================================================================
// 1. CASCADING SELECTION LOGIC
// ==============================================================================

async function loadPrograms(userId = null) {
  try {
    const targetUserId = userId || (currentUser ? currentUser.id : null);
    const url = targetUserId ? `${API_BASE}/programs?user_id=${targetUserId}` : `${API_BASE}/programs`;
    const res = await fetch(url);
    const programs = await res.json();
    const sel = document.getElementById("programSelect");
    sel.innerHTML = '<option value="">Select Program...</option>';
    programs.forEach(p => {
      sel.innerHTML += `<option value="${p.id}">${escapeHtml(p.name)}</option>`;
    });

    // Reset cascading children
    const trackSel = document.getElementById("trackSelect");
    const modSel = document.getElementById("moduleSelect");
    const classSel = document.getElementById("classSelect");
    if (trackSel) { trackSel.innerHTML = '<option value="">Choose Track</option>'; trackSel.disabled = true; }
    if (modSel) { modSel.innerHTML = '<option value="">Choose Module</option>'; modSel.disabled = true; }
    if (classSel) { classSel.innerHTML = '<option value="">Choose Class Title</option>'; classSel.disabled = true; }
    const classTitleInput = document.getElementById("classTitleInput");
    if (classTitleInput) classTitleInput.value = "";
  } catch (err) {
    console.error("Error loading programs:", err);
  }
}

async function onProgramChange(e) {
  const progId = e.target.value;
  const trackSel = document.getElementById("trackSelect");
  const modSel = document.getElementById("moduleSelect");
  const classSel = document.getElementById("classSelect");
  const classTitleInput = document.getElementById("classTitleInput");
  const classAgendasInput = document.getElementById("classAgendasInput");

  if (trackSel) {
    trackSel.innerHTML = '<option value="" selected>Choose Track</option>';
    trackSel.disabled = true;
  }
  if (modSel) {
    modSel.innerHTML = '<option value="" selected>Choose Module</option>';
    modSel.disabled = true;
  }
  if (classSel) {
    classSel.innerHTML = '<option value="" selected>Choose Class Title</option>';
    classSel.disabled = true;
  }
  if (classTitleInput) classTitleInput.value = "";
  if (classAgendasInput) classAgendasInput.value = "";

  const outlineBanner = document.getElementById("levelOutlineSummaryBanner");
  if (outlineBanner) {
    outlineBanner.classList.add("hidden");
    outlineBanner.innerHTML = "";
  }

  if (!progId) return;

  currentSelectedProgramId = progId;
  const progSel = document.getElementById("programSelect");
  const pName = progSel?.selectedOptions[0]?.text || "";
  renderProgramScriptsTable(progId, pName);

  try {
    showLoader("Loading Tracks for Enrolled Program...");
    const res = await fetch(`${API_BASE}/tracks?program_id=${progId}`);
    const tracks = await res.json();
    if (trackSel) {
      trackSel.innerHTML = '<option value="" selected>Choose Track</option>';

      // Remove Specialisations options: only keep official core program tracks
      const filteredTracks = tracks.filter(t => 
        !t.name.toLowerCase().includes("specialisation") && 
        t.id !== 135 && 
        t.id !== 136
      );

      filteredTracks.forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        trackSel.appendChild(opt);
      });

      trackSel.disabled = false;
      // Do NOT auto-select the first track: "Choose Track" by default
    }
  } finally {
    hideLoader();
  }
}

let currentLevelModules = [];

async function onTrackChange(e) {
  const trackId = e.target.value;
  const modSel = document.getElementById("moduleSelect");
  const classSel = document.getElementById("classSelect");
  const classTitleInput = document.getElementById("classTitleInput");
  const classAgendasInput = document.getElementById("classAgendasInput");

  if (modSel) {
    modSel.innerHTML = '<option value="" selected>Choose Module</option>';
    modSel.disabled = true;
  }
  if (classSel) {
    classSel.innerHTML = '<option value="" selected>Choose Class Title</option>';
    classSel.disabled = true;
  }
  if (classTitleInput) classTitleInput.value = "";
  if (classAgendasInput) classAgendasInput.value = "";

  const outlineBanner = document.getElementById("levelOutlineSummaryBanner");
  if (outlineBanner) {
    outlineBanner.classList.add("hidden");
    outlineBanner.innerHTML = "";
  }

  currentLevelModules = [];
  if (!trackId) return;

  try {
    showLoader("Loading Modules for Selected Track...");
    const res = await fetch(`${API_BASE}/modules?track_id=${trackId}`);
    const modules = await res.json();
    currentLevelModules = modules || [];

    if (modSel) {
      modSel.innerHTML = '<option value="" selected>Choose Module</option>';

      // Group modules by curriculum segment
      const segmentMap = new Map();
      modules.forEach(m => {
        const seg = m.segment || "Core Curriculum";
        if (!segmentMap.has(seg)) {
          segmentMap.set(seg, []);
        }
        segmentMap.get(seg).push(m);
      });

      if (segmentMap.size > 1) {
        segmentMap.forEach((modList, segName) => {
          const optGroup = document.createElement("optgroup");
          optGroup.label = segName;
          modList.forEach(m => {
            const opt = document.createElement("option");
            opt.value = m.id;
            const dur = m.duration_label ? ` (${m.duration_label})` : "";
            const modType = (m.module_type && m.module_type !== "Core") ? ` [${m.module_type}]` : "";
            opt.textContent = `${m.name}${modType}${dur}`;
            optGroup.appendChild(opt);
          });
          modSel.appendChild(optGroup);
        });
      } else {
        modules.forEach(m => {
          const opt = document.createElement("option");
          opt.value = m.id;
          const dur = m.duration_label ? ` (${m.duration_label})` : "";
          const modType = (m.module_type && m.module_type !== "Core") ? ` [${m.module_type}]` : "";
          opt.textContent = `${m.name}${modType}${dur}`;
          modSel.appendChild(opt);
        });
      }
      modSel.disabled = false;
      // Do NOT auto-select the first module: "Choose Module" by default
    }

  } finally {
    hideLoader();
  }
}

function openLevelOutlineModal() {
  const modal = document.getElementById("courseOutlineModal");
  const trackSel = document.getElementById("trackSelect");
  const levelName = trackSel?.selectedOptions[0]?.text || "Selected Level";
  const title = document.getElementById("courseOutlineModalTitle");
  const subtitle = document.getElementById("courseOutlineModalSubtitle");
  const tbody = document.getElementById("courseOutlineModalTableBody");

  if (!modal || !tbody) return;

  if (title) title.textContent = `Course Outline for ${levelName}`;
  if (subtitle) {
    subtitle.textContent = `Showing all ${currentLevelModules.length} modules configured for this level, organized by curriculum segment. Selecting a module from the dropdown allows authoring scripts for any of its classes.`;
  }

  let rowsHtml = "";
  currentLevelModules.forEach((m, idx) => {
    const seg = m.segment || "Core";
    const modType = m.module_type || "Core";
    const dur = m.duration_label || "1 month";
    const cCount = m.class_count || 0;
    const typeColor = modType === "Specialisation" ? "var(--accent-primary, #3b82f6)" : (modType === "Elective" ? "#9333ea" : "var(--accent-success, #10b981)");

    rowsHtml += `
      <tr style="border-bottom: 1px solid var(--border-subtle);">
        <td style="padding: 10px 14px; color: var(--text-secondary); font-weight: 600;">${idx + 1}</td>
        <td style="padding: 10px 14px; font-weight: 600; color: var(--text-primary);">${escapeHtml(seg)}</td>
        <td style="padding: 10px 14px;"><span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 4px; background: rgba(59,130,246,0.1); color: ${typeColor}; font-weight: 600;">${escapeHtml(modType)}</span></td>
        <td style="padding: 10px 14px; font-weight: 600; color: var(--text-primary);">${escapeHtml(m.name)}</td>
        <td style="padding: 10px 14px; color: var(--text-secondary);">${escapeHtml(dur)}</td>
        <td style="padding: 10px 14px; text-align: center; font-weight: 600; color: var(--text-secondary);">${cCount}</td>
      </tr>
    `;
  });

  tbody.innerHTML = rowsHtml || '<tr><td colspan="6" style="padding: 20px; text-align: center; color: var(--text-secondary);">No modules found for this level.</td></tr>';
  modal.classList.remove("hidden");
}

function closeLevelOutlineModal() {
  const modal = document.getElementById("courseOutlineModal");
  if (modal) modal.classList.add("hidden");
}

window.openLevelOutlineModal = openLevelOutlineModal;
window.closeLevelOutlineModal = closeLevelOutlineModal;

async function onModuleChange(e) {
  const modId = e.target.value;
  const classSel = document.getElementById("classSelect");
  const classTitleInput = document.getElementById("classTitleInput");
  const classAgendasInput = document.getElementById("classAgendasInput");

  if (classSel) {
    classSel.innerHTML = '<option value="" selected>Choose Class Title</option>';
    classSel.disabled = true;
  }
  if (classTitleInput) classTitleInput.value = "";
  if (classAgendasInput) classAgendasInput.value = "";

  if (!modId) return;

  try {
    showLoader("Loading Classes for Selected Module...");
    const res = await fetch(`${API_BASE}/classes?module_id=${modId}`);
    const classes = await res.json();
    if (classSel) {
      classSel.innerHTML = '<option value="" selected>Choose Class Title</option>';
      classes.forEach(c => {
        classSel.innerHTML += `<option value="${c.id}">${escapeHtml(c.title)}</option>`;
      });
      classSel.disabled = false;
      // Do NOT auto-select the first class, per user requirement: "Choose Class Title" by default
    }
  } finally {
    hideLoader();
  }
}

async function onClassChange(e) {
  const classId = e.target.value;
  const classSel = document.getElementById("classSelect");
  const classTitleInput = document.getElementById("classTitleInput");
  const agendasInput = document.getElementById("classAgendasInput");

  if (!classId) {
    if (classTitleInput) classTitleInput.value = "";
    if (agendasInput) agendasInput.value = "";
    return;
  }

  // Pre-fill selected title into editable input
  if (classTitleInput && classSel) {
    const selectedText = classSel.selectedOptions[0]?.text || "";
    if (selectedText && selectedText !== "Choose Class Title") {
      classTitleInput.value = selectedText;
    }
  }

  try {
    showLoader("Loading Class Agendas...");
    const res = await fetch(`${API_BASE}/class/${classId}`);
    const data = await res.json();

    if (classTitleInput) classTitleInput.value = data.title || "";
    if (agendasInput) {
      // Pre-fill agendas, SME can edit them manually
      agendasInput.value = (data.agendas || []).join("\n");
    }

    const rawDur = data.duration_minutes || 90;
    const durMins = Math.round(rawDur / 10) * 10 || 90;
    const durSelect = document.getElementById("durationSelect");
    const customDurInput = document.getElementById("customDurationInput");
    const durVal = document.getElementById("durationVal");
    if (customDurInput) customDurInput.value = durMins;
    if (durVal) durVal.textContent = `${durMins} mins`;
    if (durSelect) durSelect.value = String(durMins);

    const mem = data.context_memory_preview || {};
    const memAnalogy = document.getElementById("memoryAnalogy");
    if (memAnalogy) memAnalogy.innerHTML = `<strong>Anchor Analogy:</strong> ${mem.anchor_analogy || 'Real-Time System'}`;
    const cliff = mem.cliffhanger ? `<br><strong>Cliffhanger Bridge:</strong> ${mem.cliffhanger}` : '';
    const memBridge = document.getElementById("memoryBridge");
    if (memBridge) memBridge.innerHTML = `<strong>Continuity:</strong> ${mem.is_first_class ? 'Inaugural Class: Foundational mental model setup.' : `Continuing Class: Bridges from ${mem.previous_class_title || 'prior class'}.${cliff}`}`;

    // Remove any existing script notice banner if previously rendered
    const existingNotice = document.getElementById("existingClassScriptNotice");
    if (existingNotice) existingNotice.remove();
  } finally {
    hideLoader();
  }
}

// ==============================================================================
// 2. SCRIPT INITIALIZATION & OUTLINE GENERATION
// ==============================================================================

async function onInitScript() {
  const classSel = document.getElementById("classSelect");
  const classId = classSel?.value;
  const customTitle = (classSel?.selectedOptions[0]?.text && classSel.value) ? classSel.selectedOptions[0].text : null;
  const rawAgendas = document.getElementById("classAgendasInput")?.value.trim() || "";
  const customAgendas = rawAgendas ? rawAgendas.split("\n").map(s => s.trim()).filter(Boolean) : null;

  const mixBeg = parseInt(document.getElementById("mixSlider").value);
  const codeRatio = parseInt(document.getElementById("codeRatioSlider").value);
  const directives = document.getElementById("additionalDirectives")?.value || "";
  const apiDocs = document.getElementById("apiDocs")?.value || "";
  const refUrls = document.getElementById("referenceUrls")?.value || null;
  const prevScript = document.getElementById("prevScriptUpload")?.value || "";

  const trackSel = document.getElementById("trackSelect");
  if (!trackSel?.value) {
    alert("Please select a Track before generating the outline.");
    trackSel?.focus();
    return;
  }

  const modSel = document.getElementById("moduleSelect");
  if (!modSel?.value) {
    alert("Please select a Module before generating the outline.");
    modSel?.focus();
    return;
  }

  if (!classId) {
    alert("Please select a Class Title before generating the outline.");
    classSel?.focus();
    return;
  }

  if (!rawAgendas) {
    alert("Class Agendas is required. Please enter at least one agenda for this class.");
    document.getElementById("classAgendasInput")?.focus();
    return;
  }

  const learningOutcomes = document.getElementById("learningOutcomesInput")?.value.trim() || "";
  if (!learningOutcomes) {
    alert("Learning Outcomes is required. Please specify what students will learn.");
    document.getElementById("learningOutcomesInput")?.focus();
    return;
  }

  const durSelElem = document.getElementById("durationSelect");
  if (!durSelElem?.value) {
    alert("Please choose a Class Duration before generating the outline.");
    durSelElem?.focus();
    return;
  }
  const duration = parseInt(durSelElem.value, 10);

  try {
    showLoader("Initializing Script & Querying Memory Ledger...");

    const initUrl = currentUser ? `${API_BASE}/scripts/init?user_id=${currentUser.id}` : `${API_BASE}/scripts/init`;
    const initRes = await fetch(initUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        class_id: parseInt(classId),
        custom_class_title: customTitle,
        custom_agendas: customAgendas,
        duration_minutes: duration,
        content_mix_beginner: mixBeg,
        content_mix_advanced: 100 - mixBeg,
        code_ratio: codeRatio,
        additional_resources: (refUrls || directives || ""),
        api_docs: apiDocs,
        reference_urls: refUrls,
        previous_script_context: prevScript
      })
    });

    if (!initRes.ok) {
      let errDetail = "Script initialization failed";
      try { const e = await initRes.json(); errDetail = e.detail || errDetail; } catch {}
      throw new Error(errDetail);
    }

    const initData = await initRes.json();
    currentScriptId = initData.script_id;
    currentShareableUuid = initData.shareable_uuid;

    updateScriptStatusBadge("Script WIP", "status-wip");

    showLoader("Claude Sonnet Architecting 14-18 Card Outline...");
    const outlineRes = await fetch(`${API_BASE}/scripts/${currentScriptId}/outline`, {
      method: "POST"
    });
    if (!outlineRes.ok) {
      let errDetail = "Outline generation failed";
      try { const e = await outlineRes.json(); errDetail = e.detail || errDetail; } catch {}
      throw new Error(errDetail);
    }
    const outlineData = await outlineRes.json();
    currentOutlineCards = outlineData.cards;

    renderOutlineGate(outlineData);
  } catch (err) {
    alert("Error initializing script: " + err);
  } finally {
    hideLoader();
  }
}

function renderOutlineGate(outlineData) {
  switchSmeStudioView("outline");

  if (outlineData && outlineData.cards) {
    currentOutlineCards = outlineData.cards;
  }

  const gate = document.getElementById("outlineGate");
  if (gate) {
    gate.scrollIntoView({ behavior: "smooth" });
  }

  const minsElem = document.getElementById("outlineTotalMins");
  if (minsElem) minsElem.textContent = outlineData.total_duration_mins ? outlineData.total_duration_mins.toFixed(1) : "90.0";
  const countElem = document.getElementById("outlineCardCount");
  if (countElem) countElem.textContent = outlineData.total_cards || (outlineData.cards ? outlineData.cards.length : 0);

  const grid = document.getElementById("outlineCardsList");
  grid.innerHTML = "";

  // Render cards with Edit and Chat buttons on each card
  outlineData.cards.forEach((c) => {
    const visTag = c.visual_type === "mermaid" ? "[Mermaid]"
                 : c.visual_type === "image"   ? "[Image]"
                 : c.visual_type === "animation" ? "[Animation]"
                 : "[Card]";
    grid.innerHTML += `
      <div class="outline-card" id="outlineCardNode_${c.card_index}">
        <div class="outline-card-top">
          <span class="card-num-badge">Card ${c.card_index}</span>
          <span class="card-time-badge">${c.duration_mins}m</span>
        </div>
        <div class="outline-card-title">${escapeHtml(c.title)}</div>
        <div class="outline-card-desc" id="outlineCardDesc_${c.card_index}">${escapeHtml(c.key_concept || c.pedagogical_phase)}</div>
        <div class="outline-card-bottom">
          <span class="phase-tag">${escapeHtml(c.pedagogical_phase)}</span>
          <span class="visual-indicator">${visTag}</span>
        </div>
        <div class="outline-card-actions">
          <button type="button" class="btn btn-edit" onclick="openSingleOutlineCardEdit(${c.card_index})" title="Edit Card ${c.card_index}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
            Edit
          </button>
          <button type="button" class="btn btn-chat" onclick="openSingleOutlineCardChat(${c.card_index})" title="Chat / Revise Card ${c.card_index} with AI">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            Chat
          </button>
        </div>
      </div>
    `;
  });
}

// Single Card Edit Modal Handler
function openSingleOutlineCardEdit(cardIndex) {
  const card = (currentOutlineCards || []).find(c => c.card_index === cardIndex);
  if (!card) {
    alert("Card not found");
    return;
  }

  document.getElementById("singleCardEditIndex").value = cardIndex;
  document.getElementById("singleCardEditModalTitle").textContent = `Edit Card ${cardIndex}: ${card.title}`;
  document.getElementById("singleCardEditTitle").value = card.title || "";
  document.getElementById("singleCardEditDuration").value = card.duration_mins || 6;
  
  const phaseSelect = document.getElementById("singleCardEditPhase");
  if (phaseSelect) {
    let matched = false;
    for (let opt of phaseSelect.options) {
      if (opt.value === card.pedagogical_phase) {
        opt.selected = true;
        matched = true;
        break;
      }
    }
    if (!matched) {
      phaseSelect.value = "Concept";
    }
  }

  document.getElementById("singleCardEditConcept").value = card.key_concept || "";
  document.getElementById("singleCardEditModal").classList.remove("hidden");
}

window.openSingleOutlineCardEdit = openSingleOutlineCardEdit;

// Save Single Card Edit
async function saveSingleCardEdit() {
  const cardIndex = parseInt(document.getElementById("singleCardEditIndex").value);
  const card = (currentOutlineCards || []).find(c => c.card_index === cardIndex);
  if (!card) return;

  const newTitle = document.getElementById("singleCardEditTitle").value.trim();
  const newDuration = parseFloat(document.getElementById("singleCardEditDuration").value);
  const newPhase = document.getElementById("singleCardEditPhase").value;
  const newConcept = document.getElementById("singleCardEditConcept").value.trim();

  if (!newTitle) {
    alert("Please provide a title for the card.");
    return;
  }

  if (!confirm(`Are you sure you want to save changes to Card ${cardIndex}?`)) {
    return;
  }

  card.title = newTitle;
  card.duration_mins = !isNaN(newDuration) && newDuration > 0 ? newDuration : card.duration_mins;
  card.pedagogical_phase = newPhase;
  card.key_concept = newConcept;

  document.getElementById("singleCardEditModal").classList.add("hidden");

  try {
    showLoader(`Saving updates to Card ${cardIndex}...`);
    const res = await fetch(`${API_BASE}/scripts/${currentScriptId}/outline/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "EDIT",
        modified_cards: currentOutlineCards
      })
    });
    if (!res.ok) throw new Error("Failed to save outline card edit");
    
    renderOutlineGate({
      total_duration_mins: currentOutlineCards.reduce((acc, c) => acc + (c.duration_mins || 0), 0),
      total_cards: currentOutlineCards.length,
      cards: currentOutlineCards
    });
  } catch (err) {
    alert("Error updating card: " + err.message);
  } finally {
    hideLoader();
  }
}

window.saveSingleCardEdit = saveSingleCardEdit;

// Single Card Chat Modal Handler
function openSingleOutlineCardChat(cardIndex) {
  const card = (currentOutlineCards || []).find(c => c.card_index === cardIndex);
  if (!card) {
    alert("Card not found");
    return;
  }

  document.getElementById("singleCardChatIndex").value = cardIndex;
  const titleElem = document.getElementById("singleCardChatModalTitle");
  if (titleElem) titleElem.textContent = `Chat — Card ${cardIndex}`;
  
  const promptInput = document.getElementById("singleCardChatPrompt");
  if (promptInput) promptInput.value = "";
  
  document.getElementById("singleCardChatModal").classList.remove("hidden");
  setTimeout(() => {
    if (promptInput) promptInput.focus();
  }, 100);
}

window.openSingleOutlineCardChat = openSingleOutlineCardChat;

function applyQuickPromptChip(text) {
  const promptArea = document.getElementById("singleCardChatPrompt");
  if (!promptArea) return;
  if (promptArea.value.trim()) {
    promptArea.value += "; " + text;
  } else {
    promptArea.value = text;
  }
  promptArea.focus();
}

window.applyQuickPromptChip = applyQuickPromptChip;

// Submit Single Card Chat Assist
async function submitSingleCardChat() {
  const cardIndex = parseInt(document.getElementById("singleCardChatIndex").value);
  const promptText = document.getElementById("singleCardChatPrompt").value.trim();

  if (!promptText) {
    alert("Please enter instructions for the card revision.");
    return;
  }

  if (!confirm(`Are you sure you want to revise Card ${cardIndex} with this AI prompt?`)) {
    return;
  }

  document.getElementById("singleCardChatModal").classList.add("hidden");

  try {
    showLoader(`Revising Card ${cardIndex} with Claude Sonnet...`);
    const res = await fetch(`${API_BASE}/scripts/${currentScriptId}/outline/card-assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        card_index: cardIndex,
        user_prompt: promptText
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Could not update card");
    }

    // Fetch the updated outline from backend
    const outlineRes = await fetch(`${API_BASE}/scripts/${currentScriptId}/outline`);
    if (outlineRes.ok) {
      const outlineData = await outlineRes.json();
      currentOutlineCards = outlineData.cards || [];
      renderOutlineGate(outlineData);
    }
  } catch (err) {
    alert("Error revising card: " + err.message);
  } finally {
    hideLoader();
  }
}

window.submitSingleCardChat = submitSingleCardChat;

async function onOutlineRethink() {
  const feedback = prompt("Enter ReThink Feedback for the Outliner (e.g. 'Make section 2 more hands-on with BookMyShow analogy'):");
  if (feedback === null) return;

  try {
    showLoader("ReThinking & Re-architecting Outline with Claude Sonnet...");
    const res = await fetch(`${API_BASE}/scripts/${currentScriptId}/outline/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "RETHINK",
        revision_feedback: feedback.trim() || null
      })
    });
    const data = await res.json();
    currentOutlineCards = data.cards || [];
    renderOutlineGate(data);
  } finally {
    hideLoader();
  }
}

// Current Section Drafting State
let currentDraftSectionIndex = 1;
let totalSectionsCount = 4;

async function onOutlineGtg() {
  if (!confirm("Are you sure you want to approve the Outline (GTG) and start drafting Card 1?")) return;
  try {
    showLoader("Locking Outline [GTG] & Drafting Card 1 with Claude Sonnet...");

    await fetch(`${API_BASE}/scripts/${currentScriptId}/outline/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "GTG" })
    });

    currentDraftSectionIndex = 1;
    totalSectionsCount = (currentOutlineCards && currentOutlineCards.length) ? currentOutlineCards.length : 14;

    // Draft Card 1 first (Single-card sequential progression)
    await fetch(`${API_BASE}/scripts/${currentScriptId}/generate-section?start_card=1&end_card=1&section_id=sec_1`, {
      method: "POST"
    });

    await loadScriptStudioView();
    updateSectionGateState();
  } catch (err) {
    console.error("Error drafting Card 1:", err);
    await loadScriptStudioView();
  } finally {
    hideLoader();
  }
}

function updateSectionGateState() {
  const gate = document.getElementById("sectionGateContainer");
  const title = document.getElementById("sectionGateTitle");
  const subtitle = document.getElementById("sectionGateSubtitle");
  const gtgBtn = document.getElementById("sectionGtgBtn");
  if (!gate) return;

  const totalCards = (currentOutlineCards && currentOutlineCards.length) ? currentOutlineCards.length : (currentLoadedCards ? currentLoadedCards.length : 14);
  const draftedCards = currentLoadedCards || [];
  const latestCardIndex = draftedCards.length;
  const isLatestApproved = latestCardIndex > 0 && !!draftedCards[latestCardIndex - 1]?.is_approved;

  if (latestCardIndex < totalCards) {
    gate.classList.remove("hidden");
    if (title) title.textContent = `Card ${latestCardIndex} of ${totalCards} Drafted`;
    if (subtitle) {
      if (isLatestApproved) {
        subtitle.textContent = `Card ${latestCardIndex} is approved (GTG). Ready to draft Card ${latestCardIndex + 1}.`;
      } else {
        subtitle.textContent = `Review Card ${latestCardIndex} above. Once you mark it [GTG (Approve)], Card ${latestCardIndex + 1} will generate.`;
      }
    }
    if (gtgBtn) {
      gtgBtn.textContent = `Draft Card ${latestCardIndex + 1} \u2192`;
      gtgBtn.onclick = () => advanceNextCard(latestCardIndex + 1);
    }
  } else {
    // All cards drafted
    gate.classList.remove("hidden");
    if (title) title.textContent = `All ${totalCards} Cards Drafted!`;
    if (subtitle) subtitle.textContent = "All cards are drafted. Review each card above or run the final 3-Lens Review.";
    if (gtgBtn) {
      gtgBtn.textContent = "[Run Final 3-Lens Audit & Moderator Repair]";
      gtgBtn.onclick = runFinalScriptReview;
    }
  }
}

async function advanceNextCard(targetCardIndex) {
  const draftedCards = currentLoadedCards || [];
  const prevCard = draftedCards.find(c => c.card_index === targetCardIndex - 1);
  if (prevCard && !prevCard.is_approved) {
    alert(`Please approve Card ${targetCardIndex - 1} with [GTG (Approve)] before generating Card ${targetCardIndex}.`);
    return;
  }

  if (!confirm(`Are you sure you want to generate Card ${targetCardIndex}?`)) return;

  try {
    showLoader(`Drafting Card ${targetCardIndex} with Claude Sonnet...`);
    const secId = `sec_${Math.max(1, Math.ceil(targetCardIndex / 4))}`;
    await fetch(`${API_BASE}/scripts/${currentScriptId}/generate-section?start_card=${targetCardIndex}&end_card=${targetCardIndex}&section_id=${secId}`, {
      method: "POST"
    });
    await loadScriptStudioView();
    updateSectionGateState();
  } catch (err) {
    alert("Error drafting card: " + err.message);
  } finally {
    hideLoader();
  }
}

window.advanceNextCard = advanceNextCard;

async function promptCurrentSectionAssist() {
  const promptText = prompt(`Enter prompt instruction for Section ${currentDraftSectionIndex} (e.g. "Add everyday UPI payment failure example" or "Simplify the code trace"):`);
  if (!promptText || !promptText.trim()) return;

  try {
    showLoader(`Refining Section ${currentDraftSectionIndex} with Claude Sonnet...`);
    // Re-draft section with SME prompt guidance
    const start = (currentDraftSectionIndex - 1) * 4 + 1;
    const end = currentDraftSectionIndex * 4;
    await fetch(`${API_BASE}/scripts/${currentScriptId}/generate-section?start_card=${start}&end_card=${end}&section_id=sec_${currentDraftSectionIndex}`, {
      method: "POST"
    });
    await loadScriptStudioView();
    updateSectionGateState();
  } catch (err) {
    alert("Error assisting section: " + err.message);
  } finally {
    hideLoader();
  }
}

async function rethinkCurrentSection() {
  if (!confirm(`ReThink Section ${currentDraftSectionIndex} and regenerate it from scratch?`)) return;
  const start = (currentDraftSectionIndex - 1) * 4 + 1;
  const end = currentDraftSectionIndex * 4;

  try {
    showLoader(`ReThinking Section ${currentDraftSectionIndex}...`);
    await fetch(`${API_BASE}/scripts/${currentScriptId}/generate-section?start_card=${start}&end_card=${end}&section_id=sec_${currentDraftSectionIndex}`, {
      method: "POST"
    });
    await loadScriptStudioView();
    updateSectionGateState();
  } finally {
    hideLoader();
  }
}

async function runFinalScriptReview() {
  try {
    showLoader("Running 3 Parallel Review Lenses (Gemini Flash) & Surgical Moderator Repair (Claude Sonnet)...");
    const res = await fetch(`${API_BASE}/scripts/${currentScriptId}/review`, {
      method: "POST"
    });
    const reviewData = await res.json();
    renderReviewScorecard(reviewData);
    const gate = document.getElementById("sectionGateContainer");
    if (gate) gate.classList.add("hidden");
    await loadScriptStudioView();
    alert("3-Lens Review and Moderator Auto-Repair complete! Script is ready for delivery.");
  } catch (err) {
    alert("Review completed: " + err.message);
  } finally {
    hideLoader();
  }
}

window.advanceNextSection = advanceNextSection;
window.promptCurrentSectionAssist = promptCurrentSectionAssist;
window.rethinkCurrentSection = rethinkCurrentSection;
window.runFinalScriptReview = runFinalScriptReview;

// ==============================================================================
// 3. SCRIPT STUDIO, TELEPROMPTER & INLINE EDITING
// ==============================================================================

async function loadScriptStudioView() {
  switchSmeStudioView("script");
  document.getElementById("outlineGate")?.classList.add("hidden");
  const studio = document.getElementById("studioView");
  if (studio) studio.classList.remove("hidden");

  try {
    showLoader("Loading Spoken Dialogue & Diagrams...");
    const res = await fetch(`${API_BASE}/scripts/${currentScriptId}`);
    const script = await res.json();
    currentLoadedScript = script;

    document.getElementById("studioClassTitle").textContent = script.class_title;
    const progTrackElem = document.getElementById("studioProgTrack");
    if (progTrackElem) {
      const levelLabel = script.track_name ? ` • Level: ${script.track_name}` : '';
      progTrackElem.textContent = `${script.program_name}${levelLabel} • Module: ${script.module_name}`;
    }
    document.getElementById("studioCardProgress").textContent = `${script.cards.length} Sections Drafted (${script.duration_minutes}m)`;

    // Populate defined script document header
    const docTitle = document.getElementById("scriptDocClassTitle");
    if (docTitle) docTitle.textContent = script.class_title;
    const docHierarchy = document.getElementById("scriptDocHierarchy");
    if (docHierarchy) {
      docHierarchy.innerHTML = `
        <span>Target Duration: ${script.duration_minutes} Mins</span> &bull; 
        <span>${script.cards.length} Sections</span>
      `;
    }

    // Keep draftAllBtn permanently hidden per user preference
    const draftAllBtn = document.getElementById("draftAllBtn");
    if (draftAllBtn) {
      draftAllBtn.style.display = "none";
    }

    document.getElementById("shareLinkBtn")?.classList.remove("hidden");

    const isApproved = script.status === "GTG";
    const gtgBanner = document.getElementById("smeGtgApprovedBanner");
    const activePill = document.getElementById("smeActiveScriptStatusPill");
    const moGtgBtn = document.getElementById("moGtgBtn");
    const scorePill = document.getElementById("studioScorePill");

    if (isApproved) {
      updateScriptStatusBadge("Official GTG Approved", "status-gtg");
      if (gtgBanner) gtgBanner.classList.remove("hidden");
      if (moGtgBtn) moGtgBtn.classList.add("hidden");
    } else {
      updateScriptStatusBadge(script.status || "Script WIP", "status-wip");
      if (gtgBanner) gtgBanner.classList.add("hidden");
    }
      if (currentUser && (currentUser.role === "mo" || currentUser.role === "admin")) {
        if (moGtgBtn) moGtgBtn.classList.remove("hidden");
      } else {
        if (moGtgBtn) moGtgBtn.classList.add("hidden");
      }

    currentLoadedCards = script.cards;
    renderCardsStream(script.cards);
    renderDynamicDownloadMenu();
  } finally {
    hideLoader();
  }
}

function renderCardsStream(cards) {
  const stream = document.getElementById("cardsStream");
  if (!stream) return;
  stream.innerHTML = "";

  cards.forEach(c => {
    let stageDirHtml = c.stage_directions ? `
      <div class="script-stage-direction-cue">
        <span class="stage-cue-tag">Instructor Staging Cue</span>
        <p class="stage-cue-content">${escapeHtml(c.stage_directions)}</p>
      </div>
    ` : '';

    let codeHtml = '';
    if (c.code_snippet) {
      codeHtml = `
        <div class="code-container" style="margin: 12px 0;">
          <div class="code-header">
            <span>Live Code Implementation (${escapeHtml(c.code_language || 'python')})</span>
            <button type="button" class="btn btn-secondary" style="padding: 2px 8px; font-size: 0.72rem;" onclick="copyCodeFromBlock(this)">Copy Code</button>
          </div>
          <pre class="code-block" style="margin: 0; padding: 14px;"><code>${escapeHtml(c.code_snippet)}</code></pre>
        </div>
      `;
    }

    let visualHtml = '';
    if (c.visual_content) {
      if (c.visual_type === 'mermaid') {
        visualHtml = `
          <div class="visual-container" style="margin: 16px 0; text-align: center;">
            <div class="mermaid">${c.visual_content}</div>
            <div class="visual-caption" style="margin-top: 6px; font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(c.visual_caption || 'Architecture Diagram')}</div>
          </div>
        `;
      } else if (c.visual_type === 'animation') {
        visualHtml = `
          <div class="visual-container" style="margin: 16px 0;">
            ${c.visual_content}
            <div class="visual-caption" style="margin-top: 6px; font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(c.visual_caption || 'Interactive Simulation')}</div>
          </div>
        `;
      } else if (c.visual_type === 'image') {
        const isSvgOrHtml = (c.visual_content || '').trim().startsWith('<');
        const imgBody = isSvgOrHtml 
          ? c.visual_content 
          : `<img src="${c.visual_content}" alt="${escapeHtml(c.visual_caption || '')}" style="max-width:100%; border-radius:8px;">`;
        visualHtml = `
          <div class="visual-container" style="margin: 16px 0; text-align: center;">
            ${imgBody}
            <div class="visual-caption" style="margin-top: 6px; font-size: 0.82rem; color: var(--text-muted);">${escapeHtml(c.visual_caption || 'Conceptual Infographic')}</div>
          </div>
        `;
      }
    }

    let quizHtml = '';
    if (c.quiz) {
      const q = c.quiz;
      let optionsList = (q.options || []).map(opt => `<li class="quiz-option-item">${escapeHtml(opt)}</li>`).join('');
      quizHtml = `
        <div class="quiz-container" style="margin: 14px 0;">
          <div class="quiz-question" style="font-weight: 700; color: var(--text-primary); margin-bottom: 8px;">Checkpoint Quiz: ${escapeHtml(q.question)}</div>
          <ul class="quiz-options-list" style="margin-bottom: 8px;">${optionsList}</ul>
          <div class="quiz-explanation-box">
            <strong>Diagnostic Explanation:</strong> ${escapeHtml(q.explanation)}
          </div>
        </div>
      `;
    }

    const rawParas = (c.content_script || "").split(/\n\n+/).filter(Boolean);
    const formattedDialogue = rawParas.length > 0
      ? rawParas.map(p => `<p class="script-dialogue-para">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
      : `<p class="script-dialogue-para">${escapeHtml(c.content_script || '')}</p>`;

    const isApproved = !!c.is_approved;
    const approvalBadgeHtml = isApproved 
      ? `<span class="script-meta-badge approved-badge" id="card-badge-${c.id}">Approved</span>`
      : `<span class="script-meta-badge" id="card-badge-${c.id}" style="color: var(--text-muted);">Draft</span>`;

    const gtgBtnClass = isApproved ? "script-card-action-btn script-card-gtg-btn is-approved" : "script-card-action-btn script-card-gtg-btn";
    const gtgBtnText = isApproved ? "Approved (GTG)" : "GTG (Approve)";

    stream.innerHTML += `
      <section class="script-section-block" id="section-block-${c.id}">
        <div class="script-section-header">
          <h3 class="script-section-heading">${c.card_index}. ${escapeHtml(c.title)}</h3>
          <div class="script-section-meta-tags">
            ${approvalBadgeHtml}
            <span class="script-meta-badge timing-badge">${c.duration_mins}m</span>
            <span class="script-meta-badge">${escapeHtml(c.pedagogical_phase)}</span>
          </div>
        </div>

        ${stageDirHtml}

        <div class="spoken-script-text">
          ${formattedDialogue}
        </div>

        ${visualHtml}
        ${codeHtml}
        ${quizHtml}

        <div class="script-card-actions" id="card-actions-${c.id}">
          <button type="button" class="${gtgBtnClass}" id="card-gtg-btn-${c.id}" onclick="toggleCardApproval(${c.id}, ${c.card_index})">
            ${gtgBtnText}
          </button>
          <button type="button" class="script-card-action-btn script-card-edit-btn" onclick="openCardEditModal(${c.id})">
            Edit
          </button>
          <button type="button" class="script-card-action-btn script-card-chat-btn" onclick="openChatAssistModal(${c.card_index}, '${escapeHtml(c.title).replace(/'/g, "\\'")}')">
            Chat
          </button>
        </div>
      </section>
    `;
  });

  setTimeout(() => {
    mermaid.run();
  }, 100);

  // Sync markdown to the Sandbox Editor textarea
  syncSandboxEditorFromCards(cards);
}


// Convert current cards to clean HackMD Markdown string
function generateScriptMarkdownString(cards) {
  const title = (currentLoadedScript?.class_title) || document.getElementById("studioClassTitle")?.textContent || "Lecture Script";
  const duration = (currentLoadedScript?.duration_minutes) || "90";

  let md = `# ${title}\n\n`;
  md += `> Target Duration: ${duration} Minutes | Total Sections: ${cards.length}\n\n---\n\n`;

  cards.forEach(c => {
    md += `## ${c.card_index}. ${c.title}\n`;
    md += `*Timing: ${c.duration_mins}m | Phase: ${c.pedagogical_phase}*\n\n`;

    if (c.stage_directions) {
      md += `> **Instructor Note:** ${c.stage_directions}\n\n`;
    }

    if (c.content_script) {
      md += `${c.content_script}\n\n`;
    }

    if (c.visual_content) {
      if (c.visual_type === 'mermaid') {
        md += `\`\`\`mermaid\n${c.visual_content}\n\`\`\`\n\n`;
      } else if (c.visual_type === 'image') {
        md += `![${c.visual_caption || ''}](${c.visual_content})\n\n`;
      }
    }

    if (c.code_snippet) {
      md += `\`\`\`${c.code_language || 'python'}\n${c.code_snippet}\n\`\`\`\n\n`;
    }

    if (c.quiz) {
      md += `### Checkpoint Quiz: ${c.quiz.question}\n`;
      (c.quiz.options || []).forEach(opt => {
        md += `- ${opt}\n`;
      });
      md += `\n*Explanation:* ${c.quiz.explanation}\n\n`;
    }

    md += `---\n\n`;
  });

  return md;
}

// Populate the Sandbox Editor textarea from structured cards
function syncSandboxEditorFromCards(cards) {
  const textarea = document.getElementById("sandboxMarkdownTextarea");
  if (!textarea) return;
  const md = generateScriptMarkdownString(cards);
  textarea.value = md;
  updateSandboxWordCount(md);
}

function updateSandboxWordCount(text) {
  const counter = document.getElementById("sandboxWordCount");
  if (!counter) return;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  counter.textContent = `${words} words`;
}

// Real-time live input handler for the Sandbox Editor
window.onSandboxEditorInput = function () {
  const textarea = document.getElementById("sandboxMarkdownTextarea");
  if (!textarea) return;
  const content = textarea.value;
  updateSandboxWordCount(content);

  // If marked.js is available, re-render the preview pane
  const stream = document.getElementById("cardsStream");
  if (stream && typeof marked !== "undefined") {
    // Render markdown directly inside the stream container
    stream.innerHTML = marked.parse(content);
    setTimeout(() => {
      mermaid.run();
    }, 150);
  }
};

// Sandbox View Mode Switcher: split | preview | editor
window.setSandboxView = function (mode) {
  const wrapper = document.getElementById("sandboxPanesWrapper");
  if (!wrapper) return;

  wrapper.className = `sandbox-panes-wrapper ${mode}-mode`;

  document.querySelectorAll(".sandbox-tab-btn").forEach(btn => btn.classList.remove("active"));
  if (mode === "split") document.getElementById("sandboxViewSplit")?.classList.add("active");
  if (mode === "preview") document.getElementById("sandboxViewPreview")?.classList.add("active");
  if (mode === "editor") document.getElementById("sandboxViewEditor")?.classList.add("active");
};

// 1-Click Copy Sandbox Markdown
window.copySandboxMarkdown = function () {
  const textarea = document.getElementById("sandboxMarkdownTextarea");
  const content = textarea ? textarea.value : generateScriptMarkdownString(currentLoadedCards || []);
  if (content) {
    navigator.clipboard.writeText(content);
    alert("Script Markdown copied to clipboard!");
  }
};

// Copy Code Button Helper
window.copyCodeFromBlock = function (btn) {
  const code = btn.closest(".code-container")?.querySelector("code")?.innerText || "";
  if (code) {
    navigator.clipboard.writeText(code);
    const orig = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }
};

// ==============================================================================
// SCRIPT DOWNLOAD & EXPORT UTILITIES (MARKDOWN, PDF, WORD, TXT, COPY)
// ==============================================================================

window.toggleDownloadDropdown = function (e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("downloadDropdownMenu");
  if (menu) menu.classList.toggle("hidden");
};

// Global click listener to close download dropdown
document.addEventListener("click", (e) => {
  if (!e.target.closest(".download-dropdown-wrap")) {
    document.getElementById("downloadDropdownMenu")?.classList.add("hidden");
  }
});

function getCleanScriptFilename(ext) {
  const clsTitle = (currentLoadedScript?.class_title) || document.getElementById("studioClassTitle")?.textContent || "Lecture_Script";
  const sanitized = clsTitle.replace(/[^a-zA-Z0-9_\-]/g, "_").replace(/_+/g, "_").slice(0, 60);
  return `${sanitized}_Script.${ext}`;
}

function buildScriptPlainText() {
  const title = (currentLoadedScript?.class_title) || document.getElementById("studioClassTitle")?.textContent || "Lecture Script";
  const hierarchy = document.getElementById("studioProgTrack")?.textContent || "";
  const duration = (currentLoadedScript?.duration_minutes) || document.getElementById("durationSelect")?.value || "90";

  let out = "================================================================================\n";
  out += "SCALER MASTERCLASS LECTURE SCRIPT\n";
  out += `Title: ${title}\n`;
  out += `Context: ${hierarchy}\n`;
  out += `Target Duration: ${duration} Minutes\n`;
  out += "================================================================================\n\n";

  (currentLoadedCards || []).forEach(c => {
    out += `--------------------------------------------------------------------------------\n`;
    out += `SECTION ${c.card_index}: ${c.title.toUpperCase()}\n`;
    out += `[Timing: ${c.duration_mins} mins | Pedagogical Phase: ${c.pedagogical_phase}]\n`;
    out += `--------------------------------------------------------------------------------\n\n`;

    if (c.stage_directions) {
      out += `[INSTRUCTOR STAGING CUE]:\n${c.stage_directions}\n\n`;
    }

    out += `[SPOKEN LECTURE DIALOGUE]:\n${c.content_script}\n\n`;

    if (c.code_snippet) {
      out += `[CODE IMPLEMENTATION (${c.code_language || 'python'})]:\n${c.code_snippet}\n\n`;
    }

    if (c.quiz) {
      out += `[CHECKPOINT QUIZ]:\n${c.quiz.question}\n`;
      (c.quiz.options || []).forEach(opt => {
        out += `  - ${opt}\n`;
      });
      out += `Diagnostic Explanation: ${c.quiz.explanation}\n\n`;
    }
    out += "\n";
  });

  out += "================================================================================\n";
  out += "END OF LECTURE SCRIPT\n";
  out += "================================================================================\n";
  return out;
}

function detectTechnicalContext() {
  const prog = (currentLoadedScript?.program_name || document.getElementById("programSelect")?.selectedOptions?.[0]?.text || "").toLowerCase();
  const track = (currentLoadedScript?.track_name || document.getElementById("trackSelect")?.selectedOptions?.[0]?.text || "").toLowerCase();
  const mod = (currentLoadedScript?.module_name || document.getElementById("moduleSelect")?.selectedOptions?.[0]?.text || "").toLowerCase();
  const title = (currentLoadedScript?.class_title || document.getElementById("studioClassTitle")?.textContent || "").toLowerCase();

  const isDataScienceOrAI = prog.includes("dsml") || prog.includes("data science") || prog.includes("machine learning") ||
                            prog.includes("ai") || prog.includes("artificial") || track.includes("dsml") ||
                            track.includes("ml") || track.includes("ai") || mod.includes("python") ||
                            mod.includes("pandas") || mod.includes("numpy") || mod.includes("deep learning") ||
                            mod.includes("machine learning") || title.includes("model") || title.includes("neural") ||
                            title.includes("regression") || title.includes("classification") || title.includes("dataset") ||
                            title.includes("pytorch") || title.includes("tensorflow") || title.includes("clustering") ||
                            title.includes("llm") || title.includes("nlp") || title.includes("computer vision");

  const isSoftwareEngineering = prog.includes("software") || prog.includes("backend") || prog.includes("system design") ||
                                prog.includes("dsa") || track.includes("backend") || track.includes("system design") ||
                                track.includes("dsa") || mod.includes("system design") || mod.includes("architecture") ||
                                mod.includes("microservices") || title.includes("architecture") || title.includes("concurrency") ||
                                title.includes("distributed") || title.includes("caching") || title.includes("database");

  return {
    isDataScienceOrAI,
    isSoftwareEngineering,
    programName: currentLoadedScript?.program_name || "Engineering",
    moduleName: currentLoadedScript?.module_name || "Module"
  };
}

function renderDynamicDownloadMenu() {
  const menu = document.getElementById("downloadDropdownMenu");
  if (!menu) return;

  const ctx = detectTechnicalContext();
  let itemsHtml = "";

  // 1. Google Colab / Jupyter Notebook (.ipynb) for AIML, DSML, Python, or data modules
  if (ctx.isDataScienceOrAI) {
    itemsHtml += `
      <button type="button" class="download-item-btn" onclick="downloadScript('colab')" style="background: rgba(2, 132, 199, 0.08); font-weight: 600;">
        <span>Google Colab / Jupyter Notebook</span>
        <span class="download-item-ext" style="color: var(--primary-color); font-weight: 700;">.IPYNB</span>
      </button>
    `;
  }

  // 2. Microsoft Word Document (.doc) formatted for lecture delivery
  itemsHtml += `
    <button type="button" class="download-item-btn" onclick="downloadScript('doc')">
      <span>Microsoft Word Lecture Notes</span>
      <span class="download-item-ext">.DOC</span>
    </button>
  `;

  // 3. Clean Markdown (.md)
  itemsHtml += `
    <button type="button" class="download-item-btn" onclick="downloadScript('markdown')">
      <span>Canonical Markdown Script</span>
      <span class="download-item-ext">.MD</span>
    </button>
  `;

  // 4. Standalone Code File if lecture has live code
  const hasCode = (currentLoadedCards || []).some(c => !!c.code_snippet);
  if (hasCode) {
    const ext = ctx.isDataScienceOrAI ? "py" : "py";
    const label = ctx.isDataScienceOrAI ? "Python Runnable Code Solution" : "Lecture Starter & Solution Code";
    itemsHtml += `
      <button type="button" class="download-item-btn" onclick="downloadScript('code')">
        <span>${label}</span>
        <span class="download-item-ext">.${ext.toUpperCase()}</span>
      </button>
    `;
  }

  // 5. Formatted PDF Printout
  itemsHtml += `
    <button type="button" class="download-item-btn" onclick="downloadScript('pdf')">
      <span>Print / PDF Document</span>
      <span class="download-item-ext">.PDF</span>
    </button>
  `;

  // 6. Plain Text Script
  itemsHtml += `
    <button type="button" class="download-item-btn" onclick="downloadScript('txt')">
      <span>Teleprompter Plain Text</span>
      <span class="download-item-ext">.TXT</span>
    </button>
  `;

  menu.innerHTML = itemsHtml;
}

window.downloadScript = async function (format) {
  document.getElementById("downloadDropdownMenu")?.classList.add("hidden");

  if (!currentLoadedCards || currentLoadedCards.length === 0) {
    alert("No script sections available to download.");
    return;
  }

  if (format === "markdown") {
    await onExportMarkdown();
  } else if (format === "pdf") {
    // Triggers print preview with print stylesheet
    window.print();
  } else if (format === "txt") {
    const txtContent = buildScriptPlainText();
    const blob = new Blob([txtContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getCleanScriptFilename("txt");
    a.click();
    URL.revokeObjectURL(url);
  } else if (format === "colab") {
    // Generate valid Jupyter Notebook JSON (.ipynb) ready for Google Colab
    const nb = generateJupyterNotebook();
    const blob = new Blob([JSON.stringify(nb, null, 2)], { type: "application/x-ipynb+json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getCleanScriptFilename("ipynb");
    a.click();
    URL.revokeObjectURL(url);
  } else if (format === "code") {
    // Collect all code snippets into a runnable Python / script file
    const codeBlocks = (currentLoadedCards || []).filter(c => !!c.code_snippet);
    let codeFileText = `# ==============================================================================\n`;
    codeFileText += `# SCALER LIVE CODE IMPLEMENTATION\n`;
    codeFileText += `# Class: ${(currentLoadedScript?.class_title) || 'Lecture'}\n`;
    codeFileText += `# ==============================================================================\n\n`;
    codeBlocks.forEach(c => {
      codeFileText += `# --- Card ${c.card_index}: ${c.title} ---\n`;
      codeFileText += `${c.code_snippet}\n\n`;
    });
    const blob = new Blob([codeFileText], { type: "text/x-python;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getCleanScriptFilename("py");
    a.click();
    URL.revokeObjectURL(url);
  } else if (format === "doc") {
    const title = (currentLoadedScript?.class_title) || document.getElementById("studioClassTitle")?.textContent || "Lecture Script";
    const hierarchy = document.getElementById("studioProgTrack")?.textContent || "";
    const duration = (currentLoadedScript?.duration_minutes) || document.getElementById("durationSelect")?.value || "90";

    let html = `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>${escapeHtml(title)}</title>
<style>
  body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; line-height: 1.6; color: #1e293b; margin: 36px; }
  h1 { font-size: 22pt; color: #0284c7; margin-bottom: 4px; font-weight: bold; }
  h2 { font-size: 14pt; color: #0f172a; border-bottom: 2px solid #e2e8f0; padding-bottom: 4px; margin-top: 28px; }
  .meta-banner { font-size: 10pt; color: #64748b; margin-bottom: 24px; }
  .cue { background: #fef3c7; border-left: 4px solid #f59e0b; padding: 10px 14px; margin: 12px 0; font-weight: 500; }
  .cue-tag { font-size: 8pt; font-weight: bold; color: #b45309; text-transform: uppercase; margin-bottom: 2px; }
  .dialogue-title { font-size: 9pt; font-weight: bold; color: #64748b; text-transform: uppercase; margin-top: 10px; }
  .dialogue-para { font-size: 11.5pt; line-height: 1.75; color: #0f172a; margin: 10px 0; }
  pre { background: #f8fafc; border: 1px solid #cbd5e1; padding: 12px; font-family: Consolas, monospace; font-size: 10pt; margin: 12px 0; }
  .quiz { background: #eff6ff; border: 1px solid #bfdbfe; padding: 12px 16px; margin: 14px 0; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 30px 0; }
  .footer { text-align: center; font-size: 9pt; color: #94a3b8; margin-top: 40px; }
</style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta-banner">${escapeHtml(hierarchy)} &bull; ${duration} Minutes &bull; ${currentLoadedCards.length} Sections</div>
  <hr/>
`;

    currentLoadedCards.forEach(c => {
      html += `<h2>Section ${c.card_index}: ${escapeHtml(c.title)} (${c.duration_mins}m &bull; ${escapeHtml(c.pedagogical_phase)})</h2>`;
      if (c.stage_directions) {
        html += `<div class="cue"><div class="cue-tag">Instructor Staging Cue</div><div>${escapeHtml(c.stage_directions)}</div></div>`;
      }
      html += `<div class="dialogue-title">Spoken Lecture Dialogue</div>`;
      const paras = (c.content_script || "").split(/\n\n+/).filter(Boolean);
      paras.forEach(p => {
        html += `<p class="dialogue-para">${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`;
      });
      if (c.code_snippet) {
        html += `<pre><code>${escapeHtml(c.code_snippet)}</code></pre>`;
      }
      if (c.quiz) {
        html += `<div class="quiz"><strong>Checkpoint Quiz:</strong> ${escapeHtml(c.quiz.question)}<ul>${(c.quiz.options || []).map(o => `<li>${escapeHtml(o)}</li>`).join('')}</ul><p><em>Diagnostic Explanation:</em> ${escapeHtml(c.quiz.explanation)}</p></div>`;
      }
    });

    html += `<hr/><div class="footer">&mdash; End of Masterclass Lecture Script &mdash;</div></body></html>`;

    const blob = new Blob([html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = getCleanScriptFilename("doc");
    a.click();
    URL.revokeObjectURL(url);
  }
};

function generateJupyterNotebook() {
  const title = (currentLoadedScript?.class_title) || document.getElementById("studioClassTitle")?.textContent || "Lecture Notebook";
  const hierarchy = document.getElementById("studioProgTrack")?.textContent || "";
  const duration = (currentLoadedScript?.duration_minutes) || "90";

  const cells = [
    {
      cell_type: "markdown",
      metadata: { colab_type: "text" },
      source: [
        `# ${title}\n`,
        `**Curriculum Track:** ${hierarchy}  \n`,
        `**Target Duration:** ${duration} Minutes  \n`,
        `*Auto-generated Scaler Masterclass Interactive Google Colab Notebook*\n\n`,
        `---\n`
      ]
    }
  ];

  (currentLoadedCards || []).forEach(c => {
    let mdContent = `## Card ${c.card_index}: ${c.title} (${c.duration_mins}m - ${c.pedagogical_phase})\n\n`;
    if (c.stage_directions) {
      mdContent += `> **Instructor Cue:** ${c.stage_directions}\n\n`;
    }
    mdContent += `### Spoken Lecture Concept\n${c.content_script}\n\n`;

    cells.push({
      cell_type: "markdown",
      metadata: { colab_type: "text" },
      source: mdContent.split("\n").map(l => l + "\n")
    });

    if (c.code_snippet) {
      cells.push({
        cell_type: "code",
        execution_count: null,
        metadata: { colab: {} },
        outputs: [],
        source: c.code_snippet.split("\n").map((line, idx, arr) => idx === arr.length - 1 ? line : line + "\n")
      });
    }

    if (c.quiz) {
      const q = c.quiz;
      let quizMd = `### Checkpoint Quiz: ${q.question}\n`;
      (q.options || []).forEach((opt, oIdx) => {
        quizMd += `- [ ] **Option ${String.fromCharCode(65 + oIdx)}:** ${opt}\n`;
      });
      quizMd += `\n<details><summary><b>Click to see Diagnostic Explanation</b></summary>\n\n${q.explanation}\n</details>\n`;
      cells.push({
        cell_type: "markdown",
        metadata: { colab_type: "text" },
        source: quizMd.split("\n").map(l => l + "\n")
      });
    }
  });

  return {
    nbformat: 4,
    nbformat_minor: 0,
    metadata: {
      colab: {
        name: title,
        provenance: []
      },
      kernelspec: {
        name: "python3",
        display_name: "Python 3"
      },
      language_info: {
        name: "python"
      }
    },
    cells: cells
  };
}

window.copyFullScriptToClipboard = async function () {
  const text = buildScriptPlainText();
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById("copyScriptBtn");
    if (btn) {
      const orig = btn.innerHTML;
      btn.innerHTML = `<span>Copied to Clipboard!</span>`;
      btn.style.borderColor = "var(--success-color)";
      btn.style.color = "var(--success-color)";
      setTimeout(() => {
        btn.innerHTML = orig;
        btn.style.borderColor = "";
        btn.style.color = "";
      }, 2500);
    }
  } catch (err) {
    alert("Could not copy script automatically: " + err);
  }
};

// Card Approval Toggle (GTG)
window.toggleCardApproval = async function (cardId, cardIndex) {
  const card = (currentLoadedCards || []).find(c => c.id === cardId);
  const currentStatus = card ? !!card.is_approved : false;
  const nextStatus = !currentStatus;

  const actionName = nextStatus ? `approve Card ${cardIndex} (GTG)` : `revert Card ${cardIndex} to Draft`;
  if (!confirm(`Are you sure you want to ${actionName}?`)) {
    return;
  }

  // Optimistic UI update
  const gtgBtn = document.getElementById(`card-gtg-btn-${cardId}`);
  const badge = document.getElementById(`card-badge-${cardId}`);
  if (gtgBtn) {
    if (nextStatus) {
      gtgBtn.classList.add("is-approved");
      gtgBtn.textContent = "Approved (GTG)";
    } else {
      gtgBtn.classList.remove("is-approved");
      gtgBtn.textContent = "GTG (Approve)";
    }
  }
  if (badge) {
    if (nextStatus) {
      badge.className = "script-meta-badge approved-badge";
      badge.textContent = "Approved";
      badge.style.color = "";
    } else {
      badge.className = "script-meta-badge";
      badge.textContent = "Draft";
      badge.style.color = "var(--text-muted)";
    }
  }
  if (card) {
    card.is_approved = nextStatus;
  }

  try {
    const res = await fetch(`${API_BASE}/scripts/${currentScriptId}/cards/${cardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_approved: nextStatus })
    });
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    // If user just approved (GTG) the latest card in the deck and more outline cards remain:
    const totalCards = (currentOutlineCards && currentOutlineCards.length) ? currentOutlineCards.length : (currentLoadedCards ? currentLoadedCards.length : 14);
    const draftedCount = (currentLoadedCards || []).length;
    
    if (nextStatus && cardIndex === draftedCount && cardIndex < totalCards) {
      const nextCardIndex = cardIndex + 1;
      const shouldDraftNext = confirm(`Card ${cardIndex} is now Approved (GTG)!\n\nWould you like to start generating Card ${nextCardIndex} now?`);
      if (shouldDraftNext) {
        await advanceNextCard(nextCardIndex);
      } else {
        updateSectionGateState();
      }
    } else {
      updateSectionGateState();
    }
  } catch (err) {
    console.error("Failed to persist card approval:", err);
    // Revert optimistic update
    if (card) card.is_approved = currentStatus;
    if (gtgBtn) {
      if (currentStatus) {
        gtgBtn.classList.add("is-approved");
        gtgBtn.textContent = "Approved (GTG)";
      } else {
        gtgBtn.classList.remove("is-approved");
        gtgBtn.textContent = "GTG (Approve)";
      }
    }
    if (badge) {
      if (currentStatus) {
        badge.className = "script-meta-badge approved-badge";
        badge.textContent = "Approved";
      } else {
        badge.className = "script-meta-badge";
        badge.textContent = "Draft";
      }
    }
    alert("Could not update approval status: " + err.message);
  }
};

// In-line Edit Handler (PRD FR-11)
window.openCardEditModal = function (cardId) {

  const card = currentLoadedCards.find(c => c.id === cardId);
  if (!card) return;

  document.getElementById("editCardId").value = card.id;
  document.getElementById("editModalTitle").textContent = `Edit Card ${card.card_index}: ${card.title}`;
  document.getElementById("editCardTitle").value = card.title;
  document.getElementById("editCardStageDir").value = card.stage_directions || "";
  document.getElementById("editCardScript").value = card.content_script;
  document.getElementById("editCardCode").value = card.code_snippet || "";

  document.getElementById("cardEditModal").classList.remove("hidden");
};

async function onSaveCardEdit() {
  const cardId = document.getElementById("editCardId").value;
  const title = document.getElementById("editCardTitle").value;
  const stageDir = document.getElementById("editCardStageDir").value;
  const scriptText = document.getElementById("editCardScript").value;
  const code = document.getElementById("editCardCode").value;

  if (!confirm("Are you sure you want to save these edits to the card?")) {
    return;
  }

  try {
    showLoader("Saving Card Edits...");
    await fetch(`${API_BASE}/scripts/${currentScriptId}/cards/${cardId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title,
        stage_directions: stageDir,
        content_script: scriptText,
        code_snippet: code
      })
    });

    document.getElementById("cardEditModal").classList.add("hidden");
    await loadScriptStudioView();
  } catch (err) {
    alert("Error saving edits: " + err);
  } finally {
    hideLoader();
  }
}

// AI Chat Co-Pilot Handler (PRD FR-11 & FR-21)
window.openChatAssistModal = function (cardIndex, cardTitle) {
  document.getElementById("chatCardIndex").value = cardIndex;
  document.getElementById("chatModalTitle").textContent = `AI Chat Assist (Card ${cardIndex}: ${cardTitle})`;
  document.getElementById("chatPromptInput").value = "";
  document.getElementById("chatAssistModal").classList.remove("hidden");
};

async function onSubmitChatAssist() {
  const cardIndex = parseInt(document.getElementById("chatCardIndex").value);
  const prompt = document.getElementById("chatPromptInput").value;

  if (!prompt) {
    alert("Please enter revision instructions.");
    return;
  }

  if (!confirm(`Are you sure you want to revise Card ${cardIndex} with this AI instruction?`)) {
    return;
  }

  try {
    showLoader("Claude Sonnet Executing Card Revision...");
    await fetch(`${API_BASE}/scripts/${currentScriptId}/chat-assist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        card_index: cardIndex,
        user_prompt: prompt
      })
    });

    document.getElementById("chatAssistModal").classList.add("hidden");
    await loadScriptStudioView();
  } catch (err) {
    alert("Error refining card: " + err);
  } finally {
    hideLoader();
  }
}

// Draft All Remaining Sections Handler
async function onDraftAllRemaining() {
  try {
    showLoader("Drafting All Remaining Cards in Deck...");
    await fetch(`${API_BASE}/scripts/${currentScriptId}/draft-all`, {
      method: "POST"
    });
    await loadScriptStudioView();
  } catch (err) {
    alert("Error drafting remaining sections: " + err);
  } finally {
    hideLoader();
  }
}

// Export Markdown Handler
async function onExportMarkdown() {
  try {
    showLoader("Packaging Markdown Script...");
    const res = await fetch(`${API_BASE}/scripts/${currentScriptId}/export/markdown`);
    const data = await res.json();

    const blob = new Blob([data.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.filename;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Error exporting markdown: " + err);
  } finally {
    hideLoader();
  }
}

// Share Script to HackMD.io
window.shareScriptToHackMD = async function () {
  if (!currentScriptId) {
    alert("No active script to share.");
    return;
  }
  try {
    showLoader("Publishing clean script to HackMD.io...");
    const textarea = document.getElementById("sandboxMarkdownTextarea");
    const customContent = textarea ? textarea.value : undefined;

    const res = await fetch(`${API_BASE}/scripts/${currentScriptId}/share-hackmd`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown_content: customContent })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.detail || "Failed to publish note to HackMD.");
    }

    // Copy live shareable link to clipboard
    if (data.url) {
      await navigator.clipboard.writeText(data.url);
      window.open(data.url, "_blank");
      alert("Successfully published to HackMD.io!\n\nLink copied to clipboard:\n" + data.url);
    }
  } catch (err) {
    alert("Error sharing to HackMD: " + err.message);
  } finally {
    hideLoader();
  }
};

// Assignments & Mock Interviews (PRD FR-23)
async function onGenerateAssignments() {
  try {
    showLoader("Generating Assignments & Mock Interview Questions (PRD FR-23)...");
    const res = await fetch(`${API_BASE}/scripts/${currentScriptId}/generate-assignments`, {
      method: "POST"
    });
    const data = await res.json();

    const container = document.getElementById("assignmentsContent");
    let homeworkHtml = data.homework_problems.map(h => `
      <div style="background:var(--bg-primary); border:1px solid var(--border-subtle); border-radius:10px; padding:14px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <strong style="color:var(--primary-glow);">${h.title}</strong>
          <span style="font-size:0.8rem; background:rgba(245,158,11,0.15); color:var(--warning-color); padding:2px 8px; border-radius:10px;">${h.difficulty} - ${h.time_limit_mins}m</span>
        </div>
        <p style="font-size:0.85rem; color:var(--text-secondary); line-height:1.4;">${h.description}</p>
        <p style="font-size:0.75rem; color:var(--text-muted); margin-top:6px;"><em>Evaluation Rubric:</em> ${h.rubric}</p>
      </div>
    `).join('');

    let interviewHtml = data.interview_questions.map(i => `
      <div style="background:var(--bg-primary); border:1px solid var(--border-subtle); border-radius:10px; padding:14px; margin-bottom:12px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:6px;">
          <strong style="color:var(--purple-accent);">${i.company}</strong>
          <span style="font-size:0.75rem; color:var(--text-muted);">Tier-1 Tech Bar</span>
        </div>
        <p style="font-size:0.88rem; color:var(--text-primary); margin-bottom:6px;"><strong>Q:</strong> ${i.question}</p>
        <p style="font-size:0.8rem; color:var(--text-secondary); line-height:1.4;"><em>Expected Answer Depth:</em> ${i.expected_depth}</p>
      </div>
    `).join('');

    container.innerHTML = `
      <h4 style="font-family:var(--font-heading); margin-bottom:12px;">Take-Home Homework Problems</h4>
      ${homeworkHtml}
      <h4 style="font-family:var(--font-heading); margin:18px 0 12px 0;">Industry Mock Interview Questions</h4>
      ${interviewHtml}
    `;

    document.getElementById("assignmentsModal").classList.remove("hidden");
  } catch (err) {
    alert("Error generating assignments: " + err);
  } finally {
    hideLoader();
  }
}

// ==============================================================================
// 4. MULTI-AGENT REVIEW AUDIT & MO GTG SIGN-OFF
// ==============================================================================

async function onRunReview() {
  try {
    showLoader("Gemini 1.5 Flash Auditing 3 Lenses (Technical, Beginner, SOP)...");
    const res = await fetch(`${API_BASE}/scripts/${currentScriptId}/review`, {
      method: "POST"
    });
    const reviewData = await res.json();

    const scorecard = document.getElementById("reviewScorecard");
    scorecard.classList.remove("hidden");

    document.getElementById("studioScorePill").textContent = `AI Quality: ${reviewData.overall_score}/10 (${reviewData.is_gtg ? 'GTG Passed' : 'Auto-Healing'})`;
    document.getElementById("studioScorePill").className = `meta-pill score-pill ${reviewData.is_gtg ? 'status-gtg' : 'status-wip'}`;

    const grid = document.getElementById("reviewCardsGrid");
    grid.innerHTML = "";

    reviewData.reviews.forEach(r => {
      const findingsList = (r.detailed_findings || []).map(f => `<li>- ${f}</li>`).join('');
      grid.innerHTML += `
        <div class="review-card">
          <div class="review-card-header">
            <span class="review-lens-name">${r.lens_name}</span>
            <span class="review-score-badge">${r.score}/10</span>
          </div>
          <p class="review-summary">${r.summary}</p>
          <ul class="review-findings-list">${findingsList}</ul>
        </div>
      `;
    });

    updateScriptStatusBadge("SME Review", "status-wip");
  } catch (err) {
    alert("Error executing review: " + err);
  } finally {
    hideLoader();
  }
}

function onMoSignOff() {
  if (!currentScriptId) {
    alert("No active script loaded to approve.");
    return;
  }
  if (!confirm("Are you sure you want to grant the official MO GTG sign-off for this script?")) {
    return;
  }
  approveScriptDirectly(currentScriptId);
}

function onShareLink() {
  const shareUrl = `${window.location.origin}/script/${currentShareableUuid}`;
  navigator.clipboard.writeText(shareUrl);
  alert("Shareable Script Permalink copied to clipboard:\n" + shareUrl);
}

// Warn user before leaving/refreshing if they are actively authoring or editing
window.addEventListener("beforeunload", (e) => {
  // If there are unsaved edits in an open modal or if an active draft exists in progress
  const cardModal = document.getElementById("cardEditModal");
  const singleEditModal = document.getElementById("singleCardEditModal");
  const isEditingCard = (cardModal && !cardModal.classList.contains("hidden")) ||
                        (singleEditModal && !singleEditModal.classList.contains("hidden"));
  const hasActiveDraft = !!currentScriptId;

  if (isEditingCard || hasActiveDraft) {
    const confirmationMessage = "You have an active script session or unsaved edits. Are you sure you want to refresh? Any unsaved edits will not be saved.";
    e.preventDefault();
    e.returnValue = confirmationMessage;
    return confirmationMessage;
  }
});

// Utility Helpers
function updateScriptStatusBadge(text, className) {
  const badge = document.getElementById("activeScriptBadge");
  badge.textContent = `Status: ${text}`;
  badge.className = `status-badge ${className}`;
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==============================================================================
// 9. MODULE OWNER (MO) CURRICULUM CONSOLE & REAL-TIME SYNC (PRD FR-3, FR-5)
// ==============================================================================

async function onOpenMoConsole() {
  const modal = document.getElementById("moCurriculumModal");
  if (!modal) return;
  modal.classList.remove("hidden");

  // Populate filter dropdown with 5 programs if not already populated
  const filter = document.getElementById("moProgramFilter");
  if (filter && filter.options.length <= 1) {
    try {
      const res = await fetch(`${API_BASE}/programs`);
      const programs = await res.json();
      filter.innerHTML = '<option value="">All 5 Programs</option>';
      programs.forEach(p => {
        filter.innerHTML += `<option value="${p.id}">${p.name}</option>`;
      });
    } catch (e) {
      console.error("Error loading MO filter programs:", e);
    }
  }

  fetchAndRenderMoTree();
}

function onCloseMoConsole() {
  const modal = document.getElementById("moCurriculumModal");
  if (modal) modal.classList.add("hidden");
}

async function fetchAndRenderMoTree() {
  const userParam = (currentUser && currentUser.role === "mo") ? `user_id=${currentUser.id}` : "";
  const moScopeFilter = document.getElementById("moScopeProgramFilter");
  const filterVal = moScopeFilter ? moScopeFilter.value : "";
  let url = `${API_BASE}/curriculum/full-tree`;
  const params = [];
  if (userParam) params.push(userParam);
  if (filterVal) params.push(`program_id=${filterVal}`);
  if (params.length > 0) url += `?${params.join("&")}`;

  try {
    const res = await fetch(url);
    const tree = await res.json();
    moLoadedTree = tree;
    const moContainer = document.getElementById("moDashboardTreeContainer");
    const adminContainer = document.getElementById("adminCurriculumTreeContainer");
    const modalContainer = document.getElementById("moCurriculumTreeContainer");
    if (moContainer) renderCurriculumTree(tree, moContainer);
    if (adminContainer) renderCurriculumTree(tree, adminContainer);
    if (modalContainer) renderCurriculumTree(tree, modalContainer);
  } catch (err) {
    console.error("Failed to render tree:", err);
  }
}

async function refreshCurriculumDataGlobally() {
  try {
    // 1. Reload programs in system and cascading selectors
    if (currentUser) {
      await loadPrograms(currentUser.id);
      if (currentUser.role === "sme") {
        await renderSmeProgramCards(currentUser);
      }
    } else {
      await loadPrograms();
    }

    // 2. Refresh MO Dashboard data (re-fetches tree, stats, scripts)
    const moView = document.getElementById("moDashboardView");
    if (moView && !moView.classList.contains("hidden")) {
      await loadMoDashboardData();
    } else {
      await fetchAndRenderMoTree();
    }

    // 3. Refresh Admin Dashboard data if open
    const adminView = document.getElementById("adminDashboardView");
    if (adminView && !adminView.classList.contains("hidden")) {
      await loadAdminDashboardData();
    }
  } catch (err) {
    console.error("Error in refreshCurriculumDataGlobally:", err);
  }
}
window.refreshCurriculumDataGlobally = refreshCurriculumDataGlobally;

function renderMoTree(tree, container = null) {
  const target = container || document.getElementById("moDashboardTreeContainer") || document.getElementById("adminCurriculumTreeContainer") || document.getElementById("moCurriculumTreeContainer");
  if (target) renderCurriculumTree(tree, target);
}

function renderCurriculumTree(tree, container) {
  if (!container) return;

  if (!tree || tree.length === 0) {
    container.innerHTML = '<div style="color:var(--text-muted); padding:16px;">No programs found.</div>';
    return;
  }

  let html = '<div class="curriculum-tree-container">';

  tree.forEach(prog => {
    const trackCount = (prog.tracks || []).length;
    const moduleCount = (prog.tracks || []).reduce((sum, t) => sum + (t.modules ? t.modules.length : 0), 0);
    const classCount = (prog.tracks || []).reduce((sum, t) => sum + (t.modules ? t.modules.reduce((mSum, m) => mSum + (m.classes ? m.classes.length : 0), 0) : 0), 0);

    let levelSummary = `${trackCount} Tracks`;
    if (prog.id === 1) {
      levelSummary = "3 Tracks (with Specialisations)";
    } else if (prog.id === 2) {
      levelSummary = "2 Official Tracks (Beginner & Intermediate Tracks)";
    } else if (prog.id === 3) {
      levelSummary = "1 Unified Engineering Track (Core & Electives)";
    } else if (prog.id === 4) {
      levelSummary = "1 Unified Enterprise Deployment Track";
    } else if (prog.id === 5) {
      levelSummary = "2 Official Tracks (Beginner & Advanced Tracks)";
    } else if (trackCount === 1) {
      levelSummary = "1 Track";
    } else {
      levelSummary = `${trackCount} Tracks`;
    }

    html += `
      <div class="tree-program-node" data-prog-id="${prog.id}">
        <div class="tree-program-header" onclick="toggleTreeNode('prog_${prog.id}')">
          <div class="tree-program-title-area">
            <span class="tree-toggle-caret" id="caret_prog_${prog.id}">[ - ]</span>
            <span style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); font-family: var(--font-heading);">${escapeHtml(prog.name)}</span>
            <span class="program-stat-pill">${moduleCount} Modules</span>
            <span class="program-stat-pill">${classCount} Classes</span>
          </div>
          <div style="display: flex; gap: 6px; align-items: center;" onclick="event.stopPropagation()">
            <button class="btn btn-primary" style="padding: 4px 10px; font-size: 0.75rem;" onclick="openAddTrackModal(${prog.id})">+ Add Track</button>
            ${(currentUser && currentUser.role === "admin") ? `
              <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 0.75rem;" onclick="openEditProgramModal(${prog.id})">Edit Name</button>
              <button class="btn btn-warning" style="padding: 4px 10px; font-size: 0.75rem;" onclick="openDeleteProgramModal(${prog.id})">Delete</button>
            ` : ''}
          </div>
        </div>
        <div id="body_prog_${prog.id}" class="tree-program-body">
    `;

    (prog.tracks || []).forEach(trk => {
      let levelClass = "level-beginner";
      let levelLabel = "Track";
      const tLower = trk.name.toLowerCase();
      if (tLower.includes("inter")) { 
        levelClass = "level-intermediate"; 
        levelLabel = "Intermediate Track"; 
      } else if (tLower.includes("adv")) { 
        levelClass = "level-advanced"; 
        levelLabel = "Advanced Track"; 
      } else if (tLower.includes("backend")) { 
        levelClass = "level-specialisation"; 
        levelLabel = "Backend Specialisation"; 
      } else if (tLower.includes("fullstack")) { 
        levelClass = "level-specialisation"; 
        levelLabel = "Fullstack Specialisation"; 
      } else if (tLower.includes("beg")) { 
        levelClass = "level-beginner"; 
        levelLabel = "Beginner Track"; 
      } else if (tLower.includes("core") || tLower.includes("deployment") || tLower.includes("enterprise") || tLower.includes("electives")) { 
        levelClass = "level-core-track"; 
        levelLabel = "Official Track"; 
      }

      html += `
        <div class="tree-track-node" data-track-id="${trk.id}">
          <div class="tree-track-header" onclick="toggleTreeNode('track_${trk.id}')">
            <div class="tree-track-title-area">
              <span class="tree-toggle-caret" id="caret_track_${trk.id}">[ - ]</span>
              <span class="level-badge ${levelClass}">${levelLabel}</span>
              <span style="font-weight: 600; font-size: 0.95rem; color: var(--text-primary);">${escapeHtml(trk.name)}</span>
              <span style="font-size: 0.8rem; color: var(--text-secondary);">(${trk.module_count} Modules)</span>
            </div>
            <div style="display: flex; gap: 6px;" onclick="event.stopPropagation()">
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.75rem;" onclick="openAddModuleModal(${trk.id})">+ Add Module</button>
              <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.75rem;" onclick="openEditTrackModal(${trk.id})">Rename</button>
              <button class="btn btn-warning" style="padding: 3px 8px; font-size: 0.75rem;" onclick="openDeleteTrackModal(${trk.id})">Delete</button>
            </div>
          </div>
          <div id="body_track_${trk.id}" class="tree-track-body">
      `;

      (trk.modules || []).forEach(mod => {
        html += `
          <div class="tree-module-node" data-mod-id="${mod.id}">
            <div class="tree-module-header" onclick="toggleTreeNode('mod_${mod.id}')">
              <div class="tree-module-title-area" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span class="tree-toggle-caret" id="caret_mod_${mod.id}">[ - ]</span>
                <span style="font-weight: 600; color: var(--text-primary); font-size: 0.9rem;">Module: ${escapeHtml(mod.name)}</span>
                ${mod.segment ? `<span style="font-size: 0.72rem; background: rgba(59, 130, 246, 0.15); color: #60a5fa; padding: 2px 7px; border-radius: 6px; font-weight: 500;">[${escapeHtml(mod.segment)}]</span>` : ''}
                ${mod.duration_label ? `<span style="font-size: 0.72rem; background: rgba(168, 85, 247, 0.15); color: #c084fc; padding: 2px 7px; border-radius: 6px;">${escapeHtml(mod.duration_label)}</span>` : ''}
                <span style="font-size: 0.72rem; background: rgba(16,185,129,0.15); color: var(--accent-success); padding: 2px 7px; border-radius: 6px;">${escapeHtml(mod.module_type || 'Core')}</span>
                <span class="plan-badge plan-${(mod.plan_status || 'Locked').replace(/\s+/g, '-').toLowerCase()}">${escapeHtml(mod.plan_status || (mod.is_locked ? 'Locked' : 'Draft'))}</span>
                <span class="plan-source-badge">Source: ${escapeHtml(mod.plan_source || 'manual')}</span>
                ${mod.owner_name ? `<span class="plan-source-badge">Owner: ${escapeHtml(mod.owner_name)}</span>` : ''}
                <span style="font-size: 0.78rem; color: var(--text-secondary);">(${mod.class_count} Classes)</span>
              </div>
              <div style="display: flex; gap: 6px; flex-wrap: wrap;" onclick="event.stopPropagation()">
                <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.75rem;" onclick="openAddClassModal(${mod.id})">+ Add Class</button>
                <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.75rem;" onclick="openSyllabusModal(${mod.id}, '${escapeHtml(mod.name).replace(/'/g, "\\'")}')">Upload Syllabus</button>
                <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.75rem;" onclick="openEditModuleModal(${mod.id})">Edit</button>
                ${(mod.plan_status || 'Locked') === 'Locked'
                  ? `<button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.75rem;" onclick="submitModulePlanForReview(${mod.id})">Reopen for Review</button>`
                  : `<button class="btn btn-primary" style="padding: 3px 8px; font-size: 0.75rem;" onclick="lockModulePlan(${mod.id})">Review &amp; Lock</button>`}
                <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.75rem;" onclick="reassignModuleTrack(${mod.id}, ${trk.id})">Reassign Track</button>
                <button class="btn btn-warning" style="padding: 3px 8px; font-size: 0.75rem;" onclick="openDeleteModuleModal(${mod.id})">Delete</button>
              </div>
            </div>
            ${(mod.completeness_issues || []).length ? `
              <div class="plan-issues" onclick="event.stopPropagation()">
                <strong>Not ready for script generation:</strong>
                ${mod.completeness_issues.slice(0, 4).map(i => escapeHtml(i)).join(' &bull; ')}
                ${mod.completeness_issues.length > 4 ? ` &bull; +${mod.completeness_issues.length - 4} more` : ''}
              </div>` : ''}
            <div id="body_mod_${mod.id}" class="tree-module-body">
        `;

        (mod.classes || []).forEach(cls => {
          const agendas = Array.isArray(cls.agendas) ? cls.agendas : (cls.agendas ? [cls.agendas] : []);
          const agendasCount = agendas.length;
          html += `
            <div class="tree-class-item" data-class-id="${cls.id}" style="padding: 8px 12px; border-bottom: 1px solid var(--border-subtle); display: flex; flex-direction: column; gap: 6px;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div class="tree-class-info" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                  <span class="tree-class-seq" style="font-weight: 700; color: var(--primary-accent); font-size: 0.85rem;">#${cls.sequence_number}</span>
                  <span class="tree-class-title" style="font-weight: 500; color: var(--text-primary); font-size: 0.88rem;">${escapeHtml(cls.title)}</span>
                  <span class="tree-class-meta" style="font-size: 0.78rem; color: var(--text-secondary);">(${cls.duration_minutes}m &bull; ${cls.class_type || 'Live'} &bull; ${agendasCount} agendas)</span>
                  ${agendasCount > 0 ? `<button class="btn btn-ghost" style="padding: 1px 6px; font-size: 0.72rem; color: var(--text-muted);" onclick="toggleAgendasList('cls_agendas_${cls.id}')">View Agendas</button>` : ''}
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 0.75rem;" onclick="openMoEditClassModal(${cls.id})">Edit Class</button>
                  <button class="btn btn-warning" style="padding: 3px 8px; font-size: 0.75rem;" onclick="openDeleteClassModal(${cls.id})">Delete</button>
                </div>
              </div>
              ${agendasCount > 0 ? `
                <div id="cls_agendas_${cls.id}" class="hidden" style="margin-left: 24px; padding: 6px 12px; background: rgba(0,0,0,0.15); border-left: 2px solid var(--border-subtle); border-radius: 4px;">
                  <div style="font-size: 0.74rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px;">Official Agendas:</div>
                  <ul style="margin: 0; padding-left: 16px; font-size: 0.78rem; color: var(--text-muted); line-height: 1.4;">
                    ${agendas.map(ag => `<li>${escapeHtml(ag)}</li>`).join('')}
                  </ul>
                </div>
              ` : ''}
            </div>
          `;
        });

        html += `
            </div>
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;
}

// Tree interactive toggle helpers
window.toggleTreeNode = function (nodeKey) {
  const body = document.getElementById("body_" + nodeKey);
  const caret = document.getElementById("caret_" + nodeKey);
  if (!body) return;
  const isHidden = body.classList.toggle("hidden");
  if (caret) {
    caret.textContent = isHidden ? "[ + ]" : "[ - ]";
  }
};

window.toggleAgendasList = function (elId) {
  const el = document.getElementById(elId);
  if (el) {
    el.classList.toggle("hidden");
  }
};

let allTreeExpanded = true;
window.toggleExpandAllTree = function () {
  allTreeExpanded = !allTreeExpanded;
  const btn = document.getElementById("treeExpandToggleBtn");
  if (btn) btn.textContent = allTreeExpanded ? "Collapse All" : "Expand All";

  document.querySelectorAll(".tree-program-body, .tree-track-body, .tree-module-body").forEach(el => {
    if (allTreeExpanded) {
      el.classList.remove("hidden");
    } else {
      el.classList.add("hidden");
    }
  });
  document.querySelectorAll(".tree-toggle-caret").forEach(caret => {
    caret.textContent = allTreeExpanded ? "[ - ]" : "[ + ]";
  });
};

window.filterAdminTree = function (query) {
  const q = (query || "").toLowerCase().trim();
  const progNodes = document.querySelectorAll(".tree-program-node");

  if (!q) {
    progNodes.forEach(pn => {
      pn.style.display = "";
      pn.querySelectorAll(".tree-track-node, .tree-module-node, .tree-class-item").forEach(n => n.style.display = "");
    });
    return;
  }

  progNodes.forEach(pn => {
    let progMatch = false;
    const trackNodes = pn.querySelectorAll(".tree-track-node");

    trackNodes.forEach(tn => {
      let trackMatch = false;
      const modNodes = tn.querySelectorAll(".tree-module-node");

      modNodes.forEach(mn => {
        let modMatch = false;
        const classNodes = mn.querySelectorAll(".tree-class-item");

        classNodes.forEach(cn => {
          if (cn.textContent.toLowerCase().includes(q)) {
            cn.style.display = "";
            modMatch = true;
          } else {
            cn.style.display = "none";
          }
        });

        if (modMatch || mn.querySelector(".tree-module-header")?.textContent.toLowerCase().includes(q)) {
          mn.style.display = "";
          trackMatch = true;
          mn.querySelector(".tree-module-body")?.classList.remove("hidden");
        } else {
          mn.style.display = "none";
        }
      });

      if (trackMatch || tn.querySelector(".tree-track-header")?.textContent.toLowerCase().includes(q)) {
        tn.style.display = "";
        progMatch = true;
        tn.querySelector(".tree-track-body")?.classList.remove("hidden");
      } else {
        tn.style.display = "none";
      }
    });

    if (progMatch || pn.querySelector(".tree-program-header")?.textContent.toLowerCase().includes(q)) {
      pn.style.display = "";
      pn.querySelector(".tree-program-body")?.classList.remove("hidden");
    } else {
      pn.style.display = "none";
    }
  });
};

// Window-scoped function so inline onclick works
window.openMoEditClassModal = async function (classId) {
  try {
    showLoader("Loading Class Details for MO Edit...");
    const res = await fetch(`${API_BASE}/class/${classId}`);
    if (!res.ok) throw new Error("Could not load class details");
    const data = await res.json();

    document.getElementById("moEditClassId").value = data.class_id;
    document.getElementById("moClassTitleInput").value = data.title || "";
    document.getElementById("moClassDurationInput").value = data.duration_minutes || 90;
    document.getElementById("moClassTypeInput").value = data.class_type || "Live";
    document.getElementById("moClassModuleTypeInput").value = data.module_type || "Core";
    document.getElementById("moClassAgendasInput").value = (data.agendas || []).join("\n");

    document.getElementById("moEditClassModal").classList.remove("hidden");
  } catch (err) {
    alert("Error opening class editor: " + err.message);
  } finally {
    hideLoader();
  }
};

async function onSaveMoClass() {
  const classId = document.getElementById("moEditClassId").value;
  const modal = document.getElementById("moEditClassModal");
  const targetModuleId = modal.dataset.targetModuleId;

  const title = document.getElementById("moClassTitleInput").value.trim();
  const duration = parseInt(document.getElementById("moClassDurationInput").value, 10) || 90;
  const classType = document.getElementById("moClassTypeInput").value;
  const moduleType = document.getElementById("moClassModuleTypeInput").value;
  const rawAgendas = document.getElementById("moClassAgendasInput").value.trim();
  const agendas = rawAgendas.split("\n").map(s => s.trim()).filter(Boolean);

  if (!title) {
    alert("Class title cannot be empty.");
    return;
  }

  try {
    showLoader("Saving Official Curriculum to Database...");
    let res, result;
    const userParam = currentUser ? `?user_id=${currentUser.id}` : "";
    if (classId) {
      // Update existing class
      const payload = {
        title: title,
        duration_minutes: duration,
        class_type: classType,
        module_type: moduleType,
        agendas: agendas
      };
      res = await fetch(`${API_BASE}/classes/${classId}${userParam}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to save class updates.");
      }
      result = await res.json();
    } else {
      // Create new class
      const payload = {
        module_id: parseInt(targetModuleId, 10),
        sequence_number: 99,
        title: title,
        duration_minutes: duration,
        class_type: classType,
        module_type: moduleType,
        agendas: agendas
      };
      res = await fetch(`${API_BASE}/classes${userParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || "Failed to create new class.");
      }
      result = await res.json();
    }

    document.getElementById("moEditClassModal").classList.add("hidden");

    // Real-time two-way sync
    const currentModuleId = document.getElementById("moduleSelect")?.value;
    const classModuleId = (result.class && result.class.module_id) || targetModuleId;
    if (currentModuleId && parseInt(currentModuleId, 10) === parseInt(classModuleId, 10)) {
      const clsRes = await fetch(`${API_BASE}/classes?module_id=${currentModuleId}`);
      const classes = await clsRes.json();
      const classSel = document.getElementById("classSelect");
      if (classSel) {
        const currentSelectedClassId = classSel.value;
        classSel.innerHTML = '<option value="">Select Class...</option>';
        classes.forEach(c => {
          classSel.innerHTML += `<option value="${c.id}">${c.sequence_number}. ${c.title}</option>`;
        });
        if (currentSelectedClassId == classId) {
          classSel.value = classId;
          onClassChange({ target: { value: classId } });
        }
      }
    }

    await refreshCurriculumDataGlobally();
    alert(`Class '${title}' saved successfully in official catalog.`);
  } catch (err) {
    alert("Error updating class: " + err.message);
  } finally {
    hideLoader();
  }
}

async function onDeleteMoClass() {
  const classId = document.getElementById("moEditClassId").value;
  if (!classId) return;

  if (!confirm("Are you sure you want to delete this class from the official curriculum?")) return;

  try {
    showLoader("Removing Class from Curriculum...");
    const userParam = currentUser ? `?user_id=${currentUser.id}` : "";
    const res = await fetch(`${API_BASE}/classes/${classId}${userParam}`, {
      method: "DELETE"
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Failed to delete class.");
    }

    document.getElementById("moEditClassModal").classList.add("hidden");
    await refreshCurriculumDataGlobally();
    alert("Class successfully removed from official curriculum.");
  } catch (err) {
    alert("Error deleting class: " + err.message);
  } finally {
    hideLoader();
  }
}

// ==============================================================================
// 9.1 MODAL-BASED DYNAMIC CURRICULUM MANAGEMENT (ZERO POPUPS/PROMPTS)
// ==============================================================================

function findProgramInTree(progId) {
  const idNum = parseInt(progId, 10);
  return (moLoadedTree || []).find(p => p.id === idNum) || null;
}

function findTrackInTree(trackId) {
  const idNum = parseInt(trackId, 10);
  for (const p of (moLoadedTree || [])) {
    for (const t of (p.tracks || [])) {
      if (t.id === idNum) return { program: p, track: t };
    }
  }
  return null;
}

function findModuleInTree(moduleId) {
  const idNum = parseInt(moduleId, 10);
  for (const p of (moLoadedTree || [])) {
    for (const t of (p.tracks || [])) {
      for (const m of (t.modules || [])) {
        if (m.id === idNum) return { program: p, track: t, module: m };
      }
    }
  }
  return null;
}

function findClassInTree(classId) {
  const idNum = parseInt(classId, 10);
  for (const p of (moLoadedTree || [])) {
    for (const t of (p.tracks || [])) {
      for (const m of (t.modules || [])) {
        for (const c of (m.classes || [])) {
          if (c.id === idNum) return { program: p, track: t, module: m, class: c };
        }
      }
    }
  }
  return null;
}

// Entity Modal Openers
window.openAddProgramModal = function () {
  if (currentUser && currentUser.role !== "admin") {
    alert("Only Administrators can create new curriculum programs. Module Owners manage assigned programs.");
    return;
  }
  document.getElementById("curriculumEntityType").value = "program";
  document.getElementById("curriculumEntityAction").value = "add";
  document.getElementById("curriculumEntityId").value = "";
  document.getElementById("curriculumEntityParentId").value = "";

  document.getElementById("curriculumEntityModalTitle").textContent = "Add New Curriculum Program";
  document.getElementById("curriculumEntityNameLabel").textContent = "Program Name";
  const nameInput = document.getElementById("curriculumEntityNameInput");
  nameInput.value = "";
  nameInput.placeholder = "e.g. Scaler Cyber Security";

  const descGroup = document.getElementById("curriculumEntityDescGroup");
  if (descGroup) descGroup.classList.remove("hidden");
  document.getElementById("curriculumEntityDescInput").value = "";

  const typeGroup = document.getElementById("curriculumEntityModuleTypeGroup");
  if (typeGroup) typeGroup.classList.add("hidden");

  document.getElementById("curriculumEntitySubmitBtn").textContent = "Create Program";
  document.getElementById("curriculumEntityModal").classList.remove("hidden");
};

window.openEditProgramModal = function (progId) {
  if (currentUser && currentUser.role !== "admin") {
    alert("Only Administrators can edit program details. Module Owners manage tracks and modules within assigned programs.");
    return;
  }
  const prog = findProgramInTree(progId);
  document.getElementById("curriculumEntityType").value = "program";
  document.getElementById("curriculumEntityAction").value = "edit";
  document.getElementById("curriculumEntityId").value = progId;
  document.getElementById("curriculumEntityParentId").value = "";

  document.getElementById("curriculumEntityModalTitle").textContent = "Edit Program Details";
  document.getElementById("curriculumEntityNameLabel").textContent = "Program Name";
  const nameInput = document.getElementById("curriculumEntityNameInput");
  nameInput.value = prog ? prog.name : "";

  const descGroup = document.getElementById("curriculumEntityDescGroup");
  if (descGroup) descGroup.classList.remove("hidden");
  document.getElementById("curriculumEntityDescInput").value = (prog && prog.description) || "";

  const typeGroup = document.getElementById("curriculumEntityModuleTypeGroup");
  if (typeGroup) typeGroup.classList.add("hidden");

  document.getElementById("curriculumEntitySubmitBtn").textContent = "Update Program";
  document.getElementById("curriculumEntityModal").classList.remove("hidden");
};

window.openDeleteProgramModal = function (progId) {
  if (currentUser && currentUser.role !== "admin") {
    alert("Only Administrators can delete curriculum programs. Module Owners manage tracks and modules within assigned programs.");
    return;
  }
  const prog = findProgramInTree(progId);
  const name = prog ? prog.name : `Program #${progId}`;
  document.getElementById("confirmDeleteType").value = "program";
  document.getElementById("confirmDeleteId").value = progId;
  document.getElementById("curriculumConfirmTitle").textContent = "Delete Curriculum Program";
  document.getElementById("curriculumConfirmMessage").textContent = `Are you sure you want to permanently delete '${name}' and all its associated tracks, modules, and classes?`;
  document.getElementById("curriculumConfirmDeleteBtn").textContent = "Delete Program";
  document.getElementById("curriculumConfirmModal").classList.remove("hidden");
};

window.openAddTrackModal = function (progId) {
  const prog = findProgramInTree(progId);
  const progName = prog ? prog.name : "";
  document.getElementById("curriculumEntityType").value = "track";
  document.getElementById("curriculumEntityAction").value = "add";
  document.getElementById("curriculumEntityId").value = "";
  document.getElementById("curriculumEntityParentId").value = progId;

  document.getElementById("curriculumEntityModalTitle").textContent = progName ? `Add Track to ${progName}` : "Add Track";
  document.getElementById("curriculumEntityNameLabel").textContent = "Track Name";
  const nameInput = document.getElementById("curriculumEntityNameInput");
  nameInput.value = "";
  nameInput.placeholder = "e.g. System Architecture & High-Scale Systems";

  const descGroup = document.getElementById("curriculumEntityDescGroup");
  if (descGroup) descGroup.classList.add("hidden");

  const typeGroup = document.getElementById("curriculumEntityModuleTypeGroup");
  if (typeGroup) typeGroup.classList.add("hidden");

  document.getElementById("curriculumEntitySubmitBtn").textContent = "Add Track";
  document.getElementById("curriculumEntityModal").classList.remove("hidden");
};

window.openEditTrackModal = function (trackId) {
  const found = findTrackInTree(trackId);
  const name = found ? found.track.name : "";
  document.getElementById("curriculumEntityType").value = "track";
  document.getElementById("curriculumEntityAction").value = "edit";
  document.getElementById("curriculumEntityId").value = trackId;
  document.getElementById("curriculumEntityParentId").value = found ? found.program.id : "";

  document.getElementById("curriculumEntityModalTitle").textContent = "Rename Track / Level";
  document.getElementById("curriculumEntityNameLabel").textContent = "Track / Level Name";
  const nameInput = document.getElementById("curriculumEntityNameInput");
  nameInput.value = name;

  const descGroup = document.getElementById("curriculumEntityDescGroup");
  if (descGroup) descGroup.classList.add("hidden");

  const typeGroup = document.getElementById("curriculumEntityModuleTypeGroup");
  if (typeGroup) typeGroup.classList.add("hidden");

  document.getElementById("curriculumEntitySubmitBtn").textContent = "Update Track";
  document.getElementById("curriculumEntityModal").classList.remove("hidden");
};

window.openDeleteTrackModal = function (trackId) {
  const found = findTrackInTree(trackId);
  const name = found ? found.track.name : `Track #${trackId}`;
  document.getElementById("confirmDeleteType").value = "track";
  document.getElementById("confirmDeleteId").value = trackId;
  document.getElementById("curriculumConfirmTitle").textContent = "Delete Track / Level";
  document.getElementById("curriculumConfirmMessage").textContent = `Are you sure you want to permanently delete Track '${name}' and all its modules and classes?`;
  document.getElementById("curriculumConfirmDeleteBtn").textContent = "Delete Track";
  document.getElementById("curriculumConfirmModal").classList.remove("hidden");
};

window.openAddModuleModal = function (trackId) {
  const found = findTrackInTree(trackId);
  const trkName = found ? found.track.name : "";
  document.getElementById("curriculumEntityType").value = "module";
  document.getElementById("curriculumEntityAction").value = "add";
  document.getElementById("curriculumEntityId").value = "";
  document.getElementById("curriculumEntityParentId").value = trackId;

  document.getElementById("curriculumEntityModalTitle").textContent = trkName ? `Add New Module to ${trkName}` : "Add New Module";
  document.getElementById("curriculumEntityNameLabel").textContent = "Module Name";
  const nameInput = document.getElementById("curriculumEntityNameInput");
  nameInput.value = "";
  nameInput.placeholder = "e.g. Distributed Caching & Redis Mastery";

  const descGroup = document.getElementById("curriculumEntityDescGroup");
  if (descGroup) descGroup.classList.add("hidden");

  const sourcesGroup = document.getElementById("curriculumEntityApprovedSourcesGroup");
  if (sourcesGroup) { sourcesGroup.classList.remove("hidden"); document.getElementById("curriculumEntityApprovedSourcesInput").value = ""; }

  const typeGroup = document.getElementById("curriculumEntityModuleTypeGroup");
  if (typeGroup) typeGroup.classList.remove("hidden");
  document.getElementById("curriculumEntityModuleTypeSelect").value = "Core";

  document.getElementById("curriculumEntitySubmitBtn").textContent = "Add Module";
  document.getElementById("curriculumEntityModal").classList.remove("hidden");
};

window.openEditModuleModal = function (moduleId) {
  const found = findModuleInTree(moduleId);
  const name = found ? found.module.name : "";
  const modType = found ? found.module.module_type : "Core";
  const approvedSources = found ? (found.module.approved_sources || "") : "";

  document.getElementById("curriculumEntityType").value = "module";
  document.getElementById("curriculumEntityAction").value = "edit";
  document.getElementById("curriculumEntityId").value = moduleId;
  document.getElementById("curriculumEntityParentId").value = found ? found.track.id : "";

  document.getElementById("curriculumEntityModalTitle").textContent = "Edit Module Details";
  document.getElementById("curriculumEntityNameLabel").textContent = "Module Name";
  const nameInput = document.getElementById("curriculumEntityNameInput");
  nameInput.value = name;

  const descGroup = document.getElementById("curriculumEntityDescGroup");
  if (descGroup) descGroup.classList.add("hidden");

  const sourcesGroup = document.getElementById("curriculumEntityApprovedSourcesGroup");
  if (sourcesGroup) { sourcesGroup.classList.remove("hidden"); document.getElementById("curriculumEntityApprovedSourcesInput").value = approvedSources; }

  const typeGroup = document.getElementById("curriculumEntityModuleTypeGroup");
  if (typeGroup) typeGroup.classList.remove("hidden");
  document.getElementById("curriculumEntityModuleTypeSelect").value = modType || "Core";

  document.getElementById("curriculumEntitySubmitBtn").textContent = "Update Module";
  document.getElementById("curriculumEntityModal").classList.remove("hidden");
};

window.openDeleteModuleModal = function (moduleId) {
  const found = findModuleInTree(moduleId);
  const name = found ? found.module.name : `Module #${moduleId}`;
  document.getElementById("confirmDeleteType").value = "module";
  document.getElementById("confirmDeleteId").value = moduleId;
  document.getElementById("curriculumConfirmTitle").textContent = "Delete Module";
  document.getElementById("curriculumConfirmMessage").textContent = `Are you sure you want to permanently delete Module '${name}' and all its classes?`;
  document.getElementById("curriculumConfirmDeleteBtn").textContent = "Delete Module";
  document.getElementById("curriculumConfirmModal").classList.remove("hidden");
};

window.openDeleteClassModal = function (classId) {
  const found = findClassInTree(classId);
  const title = found ? found.class.title : `Class #${classId}`;
  document.getElementById("confirmDeleteType").value = "class";
  document.getElementById("confirmDeleteId").value = classId;
  document.getElementById("curriculumConfirmTitle").textContent = "Delete Class";
  document.getElementById("curriculumConfirmMessage").textContent = `Are you sure you want to permanently remove Class '${title}' from the curriculum?`;
  document.getElementById("curriculumConfirmDeleteBtn").textContent = "Delete Class";
  document.getElementById("curriculumConfirmModal").classList.remove("hidden");
};

window.closeCurriculumEntityModal = function () {
  const modal = document.getElementById("curriculumEntityModal");
  if (modal) modal.classList.add("hidden");
};

window.closeCurriculumConfirmModal = function () {
  const modal = document.getElementById("curriculumConfirmModal");
  if (modal) modal.classList.add("hidden");
};

window.submitCurriculumEntityForm = async function () {
  const entityType = document.getElementById("curriculumEntityType").value;
  const action = document.getElementById("curriculumEntityAction").value;
  const entityId = document.getElementById("curriculumEntityId").value;
  const parentId = document.getElementById("curriculumEntityParentId").value;
  const name = document.getElementById("curriculumEntityNameInput").value.trim();
  const desc = document.getElementById("curriculumEntityDescInput").value.trim();
  const modType = document.getElementById("curriculumEntityModuleTypeSelect").value;

  if (!name) {
    alert("Name cannot be empty.");
    return;
  }

  const userParam = currentUser ? `?user_id=${currentUser.id}` : "";

  try {
    showLoader(`Saving ${entityType}...`);
    let res;

    if (entityType === "program") {
      if (action === "add") {
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
        res = await fetch(`${API_BASE}/programs${userParam}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, slug, description: desc })
        });
      } else {
        res = await fetch(`${API_BASE}/programs/${entityId}${userParam}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, description: desc })
        });
      }
    } else if (entityType === "track") {
      if (action === "add") {
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
        res = await fetch(`${API_BASE}/tracks${userParam}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ program_id: parseInt(parentId, 10), name, slug })
        });
      } else {
        res = await fetch(`${API_BASE}/tracks/${entityId}${userParam}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name })
        });
      }
    } else if (entityType === "module") {
      if (action === "add") {
        const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-");
        res = await fetch(`${API_BASE}/modules${userParam}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ track_id: parseInt(parentId, 10), name, slug, module_type: modType, is_locked: true })
        });
      } else {
        res = await fetch(`${API_BASE}/modules/${entityId}${userParam}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, module_type: modType })
        });
      }
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Failed to ${action} ${entityType}.`);
    }

    closeCurriculumEntityModal();
    await refreshCurriculumDataGlobally();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    hideLoader();
  }
};

window.executeCurriculumDeletion = async function () {
  const entityType = document.getElementById("confirmDeleteType").value;
  const entityId = document.getElementById("confirmDeleteId").value;
  const userParam = currentUser ? `?user_id=${currentUser.id}` : "";

  try {
    showLoader(`Deleting ${entityType}...`);
    let res;
    if (entityType === "program") {
      res = await fetch(`${API_BASE}/programs/${entityId}${userParam}`, { method: "DELETE" });
    } else if (entityType === "track") {
      res = await fetch(`${API_BASE}/tracks/${entityId}${userParam}`, { method: "DELETE" });
    } else if (entityType === "module") {
      res = await fetch(`${API_BASE}/modules/${entityId}${userParam}`, { method: "DELETE" });
    } else if (entityType === "class") {
      res = await fetch(`${API_BASE}/classes/${entityId}${userParam}`, { method: "DELETE" });
    } else if (entityType === "user") {
      res = await fetch(`${API_BASE}/users/${entityId}`, { method: "DELETE" });
    }

    if (!res || !res.ok) {
      const err = await res?.json().catch(() => ({}));
      throw new Error(err?.detail || `Failed to delete ${entityType}.`);
    }

    closeCurriculumConfirmModal();

    if (entityType === "user") {
      const uRes = await fetch(`${API_BASE}/users`);
      allUsers = await uRes.json();
      const userSelect = document.getElementById("activeUserSelector");
      if (userSelect) {
        userSelect.innerHTML = "";
        allUsers.forEach(u => {
          userSelect.innerHTML += `<option value="${u.id}">${escapeHtml(u.name)} (${getRoleLabel(u.role)})</option>`;
        });
      }
      // If deleted user was current user, sign out
      if (currentUser && String(currentUser.id) === String(entityId)) {
        signOutCurrentUser();
        return;
      }
      if (allUsers.length > 0 && userSelect) {
        userSelect.value = allUsers[0].id;
        await switchActiveUser(allUsers[0].id, false);
      }
      await renderAdminUsersTable();
    } else {
      await refreshCurriculumDataGlobally();
    }
  } catch (err) {
    alert("Error deleting: " + err.message);
  } finally {
    hideLoader();
  }
};

// Backward-compatible window aliases
window.openAddProgramPrompt = window.openAddProgramModal;
window.openEditProgramPrompt = window.openEditProgramModal;
window.deleteProgram = window.openDeleteProgramModal;
window.openAddTrackLevelPrompt = window.openAddTrackModal;
window.openAddTrackPrompt = window.openAddTrackModal;
window.openEditTrackLevelPrompt = window.openEditTrackModal;
window.openEditTrackPrompt = window.openEditTrackModal;
window.deleteTrackLevel = window.openDeleteTrackModal;
window.deleteTrack = window.openDeleteTrackModal;
window.openAddModulePrompt = window.openAddModuleModal;
window.openEditModulePrompt = window.openEditModuleModal;
window.deleteModule = window.openDeleteModuleModal;
window.deleteClassDirectly = window.openDeleteClassModal;

window.openAddClassModal = function (modId) {
  document.getElementById("moEditClassId").value = "";
  document.getElementById("moClassTitleInput").value = "";
  document.getElementById("moClassDurationInput").value = 90;
  document.getElementById("moClassTypeInput").value = "Live";
  document.getElementById("moClassModuleTypeInput").value = "Core";
  document.getElementById("moClassAgendasInput").value = "Conceptual Foundations\nProduction Implementation\nFailure Modes & Edge Cases";

  document.getElementById("moEditClassModal").dataset.targetModuleId = modId;
  document.getElementById("moEditClassTitle").textContent = "Add New Class to Module";
  const delBtn = document.getElementById("deleteMoClassBtn");
  if (delBtn) delBtn.classList.add("hidden");
  document.getElementById("moEditClassModal").classList.remove("hidden");
};

// ==============================================================================
// 10. MULTI-PROFILE DASHBOARD WORKSPACES (PRD USERS & ROLES)
// ==============================================================================

function onRoleChange(e) {
  const role = e.target.value;
  const homeView = document.getElementById("homeDashboardView");
  const smeView = document.getElementById("smeDashboardView");
  const moView = document.getElementById("moDashboardView");
  const pmView = document.getElementById("pmDashboardView");
  const adminView = document.getElementById("adminDashboardView");
  const scriptBadge = document.getElementById("activeScriptBadge");
  const moGtgBtn = document.getElementById("moGtgBtn");
  const shareBtn = document.getElementById("shareLinkBtn");

  // Hide all views first including homeView
  if (homeView) {
    homeView.classList.add("hidden");
    homeView.classList.remove("active");
  }
  if (smeView) {
    smeView.classList.add("hidden");
    smeView.classList.remove("active");
  }
  if (moView) {
    moView.classList.add("hidden");
    moView.classList.remove("active");
  }
  if (pmView) {
    pmView.classList.add("hidden");
    pmView.classList.remove("active");
  }
  if (adminView) {
    adminView.classList.add("hidden");
    adminView.classList.remove("active");
  }

  // Scroll to top
  window.scrollTo(0, 0);

  if (role === "sme") {
    if (smeView) {
      smeView.classList.remove("hidden");
      smeView.classList.add("active");
    }
    if (scriptBadge) scriptBadge.classList.remove("hidden");
    showSmeLandingView();
    renderSmeProgramCards(currentUser);
    loadSmeAuthoredScripts();
    recordClientActivity("Workspace Opened", "Switched to SME Authoring Workspace");
  } else if (role === "mo") {
    if (moView) {
      moView.classList.remove("hidden");
      moView.classList.add("active");
    }
    if (scriptBadge) scriptBadge.classList.add("hidden");
    if (moGtgBtn) moGtgBtn.classList.add("hidden");
    if (shareBtn) shareBtn.classList.add("hidden");
    loadMoDashboardData();
    recordClientActivity("Workspace Opened", "Switched to Module Owner (MO) Review Workspace");
  } else if (role === "pm") {
    if (pmView) {
      pmView.classList.remove("hidden");
      pmView.classList.add("active");
    }
    if (scriptBadge) scriptBadge.classList.add("hidden");
    if (moGtgBtn) moGtgBtn.classList.add("hidden");
    if (shareBtn) shareBtn.classList.add("hidden");
    loadPmDashboardData();
    recordClientActivity("Workspace Opened", "Switched to Program Manager (PM) Read-Only Workspace");
  } else if (role === "admin") {
    if (adminView) {
      adminView.classList.remove("hidden");
      adminView.classList.add("active");
    }
    if (scriptBadge) scriptBadge.classList.add("hidden");
    if (moGtgBtn) moGtgBtn.classList.add("hidden");
    if (shareBtn) shareBtn.classList.add("hidden");
    loadAdminDashboardData();
    recordClientActivity("Workspace Opened", "Switched to Admin Governance Workspace");
  }
}

// Module Owner (MO) Dashboard Data Loader & Multi-Criteria Filtering Engine
let moLoadedScripts = [];
let moLoadedTree = [];

async function loadMoDashboardData() {
  try {
    showLoader("Loading Module Owner Dashboard...");

    // Populate program scope filter dropdown if not yet done
    await populateMoScopeFilter();

    // 1. Fetch pending/approved scripts queue (scoped to MO joined programs)
    const userParam = (currentUser && currentUser.role === "mo") ? `user_id=${currentUser.id}` : "";
    const scriptsUrl = `${API_BASE}/dashboard/scripts${userParam ? '?' + userParam : ''}`;
    const sRes = await fetch(scriptsUrl);
    moLoadedScripts = await sRes.json();

    // 2. Fetch full curriculum hierarchy tree (scoped to MO joined programs)
    const treeUrl = `${API_BASE}/curriculum/full-tree${userParam ? '?' + userParam : ''}`;
    const tRes = await fetch(treeUrl);
    moLoadedTree = await tRes.json();

    // 3. Populate ROW 1: Script Review Pipeline Data
    const pendingCount = (moLoadedScripts || []).filter(s => s.status !== "GTG").length;
    const approvedCount = (moLoadedScripts || []).filter(s => s.status === "GTG").length;
    const totalScripts = (moLoadedScripts || []).length;
    const gtgRate = totalScripts > 0 ? Math.round((approvedCount / totalScripts) * 100) : 0;

    const pendingEl = document.getElementById("moPendingReviewCount");
    if (pendingEl) pendingEl.textContent = pendingCount;
    const approvedEl = document.getElementById("moApprovedCount");
    if (approvedEl) approvedEl.textContent = approvedCount;
    const totalScriptsEl = document.getElementById("moTotalScriptsCount");
    if (totalScriptsEl) totalScriptsEl.textContent = totalScripts;
    const gtgRateEl = document.getElementById("moGtgRatePct");
    if (gtgRateEl) gtgRateEl.textContent = `${gtgRate}%`;

    // 4. Apply filters across script approval table and curriculum tree
    applyMoFilters();

  } catch (err) {
    console.error("Error loading MO Dashboard data:", err);
  } finally {
    hideLoader();
  }
}

function applyMoFilters() {
  const searchQuery = (document.getElementById("moSearchInput")?.value || "").toLowerCase().trim();
  const selectedProgramId = document.getElementById("moScopeProgramFilter")?.value || "";
  const selectedStatus = document.getElementById("moStatusFilter")?.value || "";
  const selectedModuleType = document.getElementById("moModuleTypeFilter")?.value || "";

  // 1. Filter Scripts Awaiting MO Sign-Off Table
  let filteredScripts = moLoadedScripts || [];
  if (selectedProgramId) {
    filteredScripts = filteredScripts.filter(s => String(s.program_id) === String(selectedProgramId));
  }
  if (selectedStatus) {
    filteredScripts = filteredScripts.filter(s => s.status === selectedStatus);
  }
  if (searchQuery) {
    filteredScripts = filteredScripts.filter(s =>
      (s.class_title && s.class_title.toLowerCase().includes(searchQuery)) ||
      (s.module_name && s.module_name.toLowerCase().includes(searchQuery)) ||
      (s.track_name && s.track_name.toLowerCase().includes(searchQuery)) ||
      (s.program_name && s.program_name.toLowerCase().includes(searchQuery))
    );
  }
  renderMoScriptsTable(filteredScripts);

  // 2. Filter Curriculum Governance Tree
  let filteredTree = moLoadedTree || [];
  if (selectedProgramId) {
    filteredTree = filteredTree.filter(p => String(p.id) === String(selectedProgramId));
  }
  if (selectedModuleType) {
    filteredTree = filteredTree.map(p => ({
      ...p,
      tracks: (p.tracks || []).map(t => ({
        ...t,
        modules: (t.modules || []).filter(m => m.module_type === selectedModuleType)
      })).filter(t => t.modules.length > 0)
    })).filter(p => p.tracks.length > 0);
  }

  const treeContainer = document.getElementById("moDashboardTreeContainer");
  if (treeContainer) {
    renderCurriculumTree(filteredTree, treeContainer);
    if (searchQuery) {
      filterAdminTree(searchQuery);
    }
  }
}

function renderMoScriptsTable(scripts) {
  const tbody = document.getElementById("moPendingScriptsTableBody");
  if (!tbody) return;

  if (!scripts || scripts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-secondary); padding: 20px;">No scripts match the filter criteria.</td></tr>';
    return;
  }

  let rowsHtml = "";
  scripts.forEach(s => {
    const isGtg = s.status === "GTG";
    const statusClass = isGtg ? "status-gtg" : (s.status === "Script WIP" ? "status-wip" : "status-idle");
    rowsHtml += `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(s.program_name)}</td>
        <td>${escapeHtml(s.track_name)} <br><span style="font-size:0.78rem; color:var(--text-muted);">${escapeHtml(s.module_name)}</span></td>
        <td style="font-weight: 500;">${escapeHtml(s.class_title)}</td>
        <td>${s.duration_minutes}m</td>
        <td>${s.cards_count} cards</td>
        <td><span class="status-pill ${statusClass}">${s.status}</span></td>
        <td>
          <div style="display: flex; gap: 6px;">
            ${!isGtg ? `<button class="btn btn-success" style="padding:4px 10px; font-size:0.75rem;" onclick="approveScriptDirectly(${s.id}, this)">Approve GTG</button>` : `<span style="font-size:0.8rem; color:var(--success-color); font-weight:600;">Approved</span>`}
            <button class="btn btn-secondary" style="padding:4px 10px; font-size:0.75rem;" onclick="viewScriptReadonly(${s.id})">Inspect</button>
          </div>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = rowsHtml;
}

function resetMoFilters() {
  const searchInput = document.getElementById("moSearchInput");
  const progFilter = document.getElementById("moScopeProgramFilter");
  const statusFilter = document.getElementById("moStatusFilter");
  const modTypeFilter = document.getElementById("moModuleTypeFilter");

  if (searchInput) searchInput.value = "";
  if (progFilter) progFilter.value = "";
  if (statusFilter) statusFilter.value = "";
  if (modTypeFilter) modTypeFilter.value = "";

  applyMoFilters();
}

window.applyMoFilters = applyMoFilters;
window.resetMoFilters = resetMoFilters;

// Populate moScopeProgramFilter dropdown (called on MO dashboard load)
async function populateMoScopeFilter() {
  const filter = document.getElementById("moScopeProgramFilter");
  if (!filter) return;
  // Only populate if still empty (beyond the default "All" option)
  if (filter.options.length > 1) return;
  try {
    const url = (currentUser && currentUser.role === "mo")
      ? `${API_BASE}/programs?user_id=${currentUser.id}`
      : `${API_BASE}/programs`;
    const res = await fetch(url);
    const programs = await res.json();
    programs.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      filter.appendChild(opt);
    });
  } catch (e) {
    console.error("Error populating MO scope filter:", e);
  }
}

// Lock a module plan (mark as Locked)
window.lockModulePlan = async function (modId) {
  try {
    showLoader("Locking Module Plan...");
    const userParam = currentUser ? `?user_id=${currentUser.id}` : "";
    const res = await fetch(`${API_BASE}/modules/${modId}${userParam}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_locked: true, plan_status: "Locked" })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to lock module.");
    }
    await refreshCurriculumDataGlobally();
  } catch (err) {
    alert("Error locking module: " + err.message);
  } finally {
    hideLoader();
  }
};

// Reopen a locked module for review (mark as Draft)
window.submitModulePlanForReview = async function (modId) {
  try {
    showLoader("Reopening Module for Review...");
    const userParam = currentUser ? `?user_id=${currentUser.id}` : "";
    const res = await fetch(`${API_BASE}/modules/${modId}${userParam}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_locked: false, plan_status: "Draft" })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to reopen module.");
    }
    await refreshCurriculumDataGlobally();
  } catch (err) {
    alert("Error reopening module: " + err.message);
  } finally {
    hideLoader();
  }
};

// Syllabus Upload Modal — calls the real FR-3 parse endpoint
window.openSyllabusModal = function (modId, modName) {
  document.getElementById("syllabusModuleId").value = modId;
  document.getElementById("syllabusModalTitle").textContent = `Upload Syllabus: ${modName || 'Module'}`;
  document.getElementById("syllabusTextInput").value = "";
  document.getElementById("syllabusModeSelect").value = "merge";
  document.getElementById("syllabusUploadModal").classList.remove("hidden");
};

window.submitSyllabusUpload = async function () {
  const modId = document.getElementById("syllabusModuleId").value;
  const syllabusText = document.getElementById("syllabusTextInput").value.trim();
  const mode = document.getElementById("syllabusModeSelect").value;

  if (!syllabusText) {
    alert("Please paste syllabus text before importing.");
    return;
  }

  try {
    showLoader("AI Parsing Syllabus into Classes...");
    const userParam = currentUser ? `?user_id=${currentUser.id}` : "";
    const res = await fetch(`${API_BASE}/modules/${modId}/syllabus${userParam}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syllabus_text: syllabusText, mode })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Syllabus parsing failed.");
    }

    const data = await res.json();
    document.getElementById("syllabusUploadModal").classList.add("hidden");
    await refreshCurriculumDataGlobally();
    alert(`Syllabus parsed successfully: ${data.parsed_classes} classes imported. Module is now In Review — lock it after verifying the classes.`);
  } catch (err) {
    alert("Error uploading syllabus: " + err.message);
  } finally {
    hideLoader();
  }
};

// Outline Edit Modal (FR-10)
window.openOutlineEditModal = function () {
  if (!currentOutlineCards || currentOutlineCards.length === 0) {
    alert("No outline loaded to edit.");
    return;
  }

  const container = document.getElementById("outlineEditCardsList");
  container.innerHTML = "";

  currentOutlineCards.forEach((c, idx) => {
    container.innerHTML += `
      <div style="background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 14px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
          <span style="font-weight: 700; color: var(--primary-accent); font-size: 0.85rem; min-width: 60px;">Card ${c.card_index}</span>
          <input type="text" class="form-control outline-edit-title" data-idx="${idx}" value="${escapeHtml(c.title)}" style="flex: 1; font-size: 0.88rem;">
          <input type="number" class="form-control outline-edit-duration" data-idx="${idx}" value="${c.duration_mins}" min="1" max="20" style="width: 80px; font-size: 0.88rem;" title="Duration (mins)">
          <select class="form-control outline-edit-phase" data-idx="${idx}" style="width: 160px; font-size: 0.82rem;">
            ${["Metadata & Lock","Agenda","Concept","Failure Mode","Code Trace","Quiz","Recap"].map(p =>
              `<option value="${p}" ${c.pedagogical_phase === p ? 'selected' : ''}>${p}</option>`
            ).join('')}
          </select>
        </div>
      </div>
    `;
  });

  document.getElementById("outlineEditModal").classList.remove("hidden");
};

window.saveOutlineEdits = async function () {
  const titles = document.querySelectorAll(".outline-edit-title");
  const durations = document.querySelectorAll(".outline-edit-duration");
  const phases = document.querySelectorAll(".outline-edit-phase");

  const modifiedCards = currentOutlineCards.map((c, idx) => ({
    ...c,
    title: titles[idx]?.value || c.title,
    duration_mins: parseFloat(durations[idx]?.value) || c.duration_mins,
    pedagogical_phase: phases[idx]?.value || c.pedagogical_phase
  }));

  try {
    showLoader("Saving Outline Edits...");
    const res = await fetch(`${API_BASE}/scripts/${currentScriptId}/outline/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "EDIT", modified_cards: modifiedCards })
    });
    if (!res.ok) throw new Error("Failed to save outline edits.");

    currentOutlineCards = modifiedCards;
    document.getElementById("outlineEditModal").classList.add("hidden");

    // Re-render the outline gate with updated cards
    renderOutlineGate({
      total_duration_mins: modifiedCards.reduce((s, c) => s + c.duration_mins, 0),
      total_cards: modifiedCards.length,
      cards: modifiedCards
    });
  } catch (err) {
    alert("Error saving edits: " + err.message);
  } finally {
    hideLoader();
  }
};

// Direct 1-Click MO GTG Approval Handler (Zero Confirmation Modal, Zero Browser Dialogs)
window.approveScriptDirectly = async function (scriptId, btnElem = null) {
  if (!scriptId) return;

  let originalHtml = "";
  if (btnElem) {
    if (btnElem.disabled) return;
    originalHtml = btnElem.innerHTML;
    btnElem.disabled = true;
    btnElem.textContent = "Approving...";
  }

  try {
    const userParam = currentUser ? `?user_id=${currentUser.id}` : "";
    const url = `${API_BASE}/scripts/${scriptId}/approve-gtg${userParam}`;
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Approval failed.");
    }
    const data = await res.json();

    // 1. Update button and row in MO scripts table
    if (btnElem && btnElem.parentElement) {
      btnElem.parentElement.innerHTML = `
        <span style="font-size:0.8rem; color:var(--success-color); font-weight:600;">Approved</span>
        <button class="btn btn-secondary" style="padding:4px 10px; font-size:0.75rem;" onclick="viewScriptReadonly(${scriptId})">Inspect</button>
      `;
    }

    // Update row status pill in MO table
    const moRow = btnElem ? btnElem.closest("tr") : document.querySelector(`button[onclick*="viewScriptReadonly(${scriptId})"]`)?.closest("tr");
    if (moRow) {
      const pill = moRow.querySelector(".status-pill");
      if (pill) {
        pill.className = "status-pill status-gtg";
        pill.textContent = "GTG";
      }
      const actionCell = moRow.cells ? moRow.cells[moRow.cells.length - 1] : null;
      if (actionCell && !btnElem) {
        actionCell.innerHTML = `
          <div style="display: flex; gap: 6px;">
            <span style="font-size:0.8rem; color:var(--success-color); font-weight:600;">Approved</span>
            <button class="btn btn-secondary" style="padding:4px 10px; font-size:0.75rem;" onclick="viewScriptReadonly(${scriptId})">Inspect</button>
          </div>
        `;
      }
    }

    // 2. Update cached MO scripts & pipeline counters
    if (Array.isArray(moLoadedScripts)) {
      const target = moLoadedScripts.find(s => s.id === parseInt(scriptId, 10));
      if (target) {
        target.status = "GTG";
        target.approved_by_mo = true;
      }
      const pendingCount = moLoadedScripts.filter(s => s.status !== "GTG").length;
      const approvedCount = moLoadedScripts.filter(s => s.status === "GTG").length;
      const totalScripts = moLoadedScripts.length;
      const gtgRate = totalScripts > 0 ? Math.round((approvedCount / totalScripts) * 100) : 0;

      const pEl = document.getElementById("moPendingReviewCount");
      if (pEl) pEl.textContent = pendingCount;
      const aEl = document.getElementById("moApprovedCount");
      if (aEl) aEl.textContent = approvedCount;
      const rEl = document.getElementById("moGtgRatePct");
      if (rEl) rEl.textContent = `${gtgRate}%`;
    }

    // 3. Update Inspect modal header if open
    const inspectTitle = document.getElementById("assignmentsModalTitle");
    if (inspectTitle && inspectTitle.textContent.includes("Script Inspection")) {
      const inspectBtn = document.getElementById(`inspectGtgBtn-${scriptId}`);
      if (inspectBtn && inspectBtn.parentElement) {
        inspectBtn.parentElement.innerHTML = `<span class="status-pill status-gtg" style="padding: 4px 12px; font-size: 0.8rem; font-weight: 600;">Official GTG Approved</span>`;
      }
      const inspectStatusPill = document.getElementById("inspectModalStatusPill");
      if (inspectStatusPill) {
        inspectStatusPill.textContent = "GTG";
      }
    }

    // 4. Update SME Authoring Studio if active script is this script
    if (currentScriptId && String(currentScriptId) === String(scriptId)) {
      updateScriptStatusBadge("Official GTG Approved", "status-gtg");
      const gtgBanner = document.getElementById("smeGtgApprovedBanner");
      if (gtgBanner) gtgBanner.classList.remove("hidden");
      const activePill = document.getElementById("smeActiveScriptStatusPill");
      if (activePill) {
        activePill.textContent = "Official GTG Approved";
        activePill.className = "status-pill status-gtg";
        activePill.classList.remove("hidden");
      }
      const scorePill = document.getElementById("studioScorePill");
      if (scorePill) {
        scorePill.textContent = "Status: Official GTG Approved";
        scorePill.className = "meta-pill score-pill status-gtg";
      }
      const moGtgBtn = document.getElementById("moGtgBtn");
      if (moGtgBtn) moGtgBtn.classList.add("hidden");
    }

    // 5. Broadcast real-time update to SME dashboard and other tabs
    broadcastScriptStatusUpdate(scriptId, "GTG");

    // 6. Refresh SME authored scripts list immediately
    if (typeof loadSmeAuthoredScripts === "function") {
      await loadSmeAuthoredScripts();
    }

  } catch (err) {
    alert("Error approving script: " + err.message);
    if (btnElem && originalHtml) {
      btnElem.disabled = false;
      btnElem.innerHTML = originalHtml;
    }
  }
};

// Fallback handlers ensuring modal is never shown
window.openGtgApprovalModal = function (scriptId) {
  window.approveScriptDirectly(scriptId);
};

window.closeMoGtgApprovalModal = function () {
  const modal = document.getElementById("moGtgApprovalModal");
  if (modal) modal.classList.add("hidden");
};

window.executeGtgApproval = function () {
  const scriptId = document.getElementById("gtgApprovalScriptId")?.value;
  if (scriptId) window.approveScriptDirectly(scriptId);
};

window.approveScriptFromMoDashboard = window.approveScriptDirectly;

// Real-Time Cross-Tab & Cross-View Synchronization
function broadcastScriptStatusUpdate(scriptId, status) {
  try {
    localStorage.setItem("gtg_status_sync", JSON.stringify({
      scriptId: parseInt(scriptId, 10),
      status: status,
      timestamp: Date.now()
    }));
  } catch (e) {}

  window.dispatchEvent(new CustomEvent("script_status_updated", {
    detail: { scriptId: parseInt(scriptId, 10), status: status }
  }));
}

function handleIncomingScriptStatusUpdate(detail) {
  if (!detail || !detail.scriptId) return;
  const scriptId = parseInt(detail.scriptId, 10);
  const status = detail.status || "GTG";

  // 1. If currently inside a program in studio, refresh that program's scripts table
  if (currentSelectedProgramId) {
    refreshCurrentProgramScripts();
  }

  const progRow = document.getElementById(`sme-prog-script-row-${scriptId}`);
  if (progRow) {
    const statusCell = progRow.querySelector(".status-pill");
    if (statusCell) {
      statusCell.className = "status-pill status-gtg";
      statusCell.textContent = "Official GTG Approved";
    }
  }

  // 2. If studio has active script matching this script
  if (currentScriptId && String(currentScriptId) === String(scriptId)) {
    updateScriptStatusBadge("Official GTG Approved", "status-gtg");
    const gtgBanner = document.getElementById("smeGtgApprovedBanner");
    if (gtgBanner) gtgBanner.classList.remove("hidden");
    const activePill = document.getElementById("smeActiveScriptStatusPill");
    if (activePill) {
      activePill.textContent = "Official GTG Approved";
      activePill.className = "status-pill status-gtg";
      activePill.classList.remove("hidden");
    }
    const scorePill = document.getElementById("studioScorePill");
    if (scorePill) {
      scorePill.textContent = "Status: Official GTG Approved";
      scorePill.className = "meta-pill score-pill status-gtg";
    }
    const moGtgBtn = document.getElementById("moGtgBtn");
    if (moGtgBtn) moGtgBtn.classList.add("hidden");
  }

  // 3. Re-render landing program cards
  renderSmeProgramCards(currentUser);
}

window.addEventListener("script_status_updated", e => handleIncomingScriptStatusUpdate(e.detail));
window.addEventListener("storage", e => {
  if (e.key === "gtg_status_sync" && e.newValue) {
    try {
      const payload = JSON.parse(e.newValue);
      handleIncomingScriptStatusUpdate(payload);
    } catch (err) {}
  }
});

// Program Manager (PM) Dashboard Data Loader (Read-Only)
let pmAllClassesData = [];

async function loadPmDashboardData() {
  try {
    showLoader("Compiling Program Manager Global Audit...");

    // 1. Stats
    const statsRes = await fetch(`${API_BASE}/dashboard/stats`);
    const stats = await statsRes.json();
    document.getElementById("pmTotalPrograms").textContent = stats.total_programs || 5;
    document.getElementById("pmTotalModules").textContent = stats.total_modules || 129;
    document.getElementById("pmTotalClasses").textContent = stats.total_classes || 1765;
    document.getElementById("pmTotalScripts").textContent = stats.total_scripts || 0;
    document.getElementById("pmGtgCount").textContent = stats.gtg_scripts || 0;
    document.getElementById("pmGtgRate").textContent = `${stats.gtg_completion_pct || 0}%`;

    // 2. Program Filter Dropdown
    const progFilter = document.getElementById("pmProgramFilterSelect");
    if (progFilter && progFilter.options.length <= 1) {
      const pRes = await fetch(`${API_BASE}/programs`);
      const progs = await pRes.json();
      progFilter.innerHTML = '<option value="">All 5 Programs</option>';
      progs.forEach(p => {
        progFilter.innerHTML += `<option value="${p.id}">${p.name}</option>`;
      });
    }

    // 3. Load Global Scripts & Classes Map
    const scriptsRes = await fetch(`${API_BASE}/dashboard/scripts`);
    const scripts = await scriptsRes.json();
    const scriptsByClassId = {};
    scripts.forEach(s => {
      scriptsByClassId[s.class_id] = s;
    });

    const progIdFilter = progFilter ? progFilter.value : "";
    const treeUrl = progIdFilter ? `${API_BASE}/curriculum/full-tree?program_id=${progIdFilter}` : `${API_BASE}/curriculum/full-tree`;
    const treeRes = await fetch(treeUrl);
    const tree = await treeRes.json();

    // Flatten classes
    pmAllClassesData = [];
    tree.forEach(p => {
      p.tracks.forEach(t => {
        t.modules.forEach(m => {
          m.classes.forEach(c => {
            const linkedScript = scriptsByClassId[c.id];
            pmAllClassesData.push({
              program_name: p.name,
              track_name: t.name,
              module_name: m.name,
              class_id: c.id,
              sequence_number: c.sequence_number,
              title: c.title,
              class_type: c.class_type,
              duration_minutes: c.duration_minutes,
              script_id: linkedScript ? linkedScript.id : null,
              script_status: linkedScript ? linkedScript.status : "Not Started",
              script_uuid: linkedScript ? linkedScript.uuid : null
            });
          });
        });
      });
    });

    renderPmCoverageTable(pmAllClassesData);

  } catch (err) {
    console.error("Error loading PM dashboard:", err);
  } finally {
    hideLoader();
  }
}

function renderPmCoverageTable(classesList) {
  const tbody = document.getElementById("pmCoverageTableBody");
  if (!tbody) return;

  if (!classesList || classesList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: var(--text-secondary); padding: 20px;">No classes match filter criteria.</td></tr>';
    return;
  }

  // Display top 100 classes for smooth DOM rendering
  const displaySlice = classesList.slice(0, 100);
  let html = "";
  displaySlice.forEach(c => {
    const isGtg = c.script_status === "GTG";
    const statusClass = isGtg ? "status-gtg" : (c.script_status === "Script WIP" ? "status-wip" : "status-idle");
    html += `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(c.program_name)}</td>
        <td>${escapeHtml(c.track_name)}</td>
        <td>${escapeHtml(c.module_name)}</td>
        <td style="font-weight: 500;">#${c.sequence_number} ${escapeHtml(c.title)}</td>
        <td><span style="font-size:0.75rem; background:rgba(255,255,255,0.05); padding:2px 8px; border-radius:6px;">${c.class_type}</span></td>
        <td>${c.duration_minutes}m</td>
        <td><span class="status-pill ${statusClass}">${c.script_status}</span></td>
        <td>
          ${c.script_id ? `<button class="btn btn-secondary" style="padding:4px 10px; font-size:0.75rem;" onclick="viewScriptReadonly(${c.script_id})">View Script</button>` : `<span style="font-size:0.75rem; color:var(--text-muted);">Unscripted</span>`}
        </td>
      </tr>
    `;
  });

  if (classesList.length > 100) {
    html += `<tr><td colspan="8" style="text-align:center; font-size:0.8rem; color:var(--text-muted); padding:10px;">Showing first 100 of ${classesList.length} classes. Use search or program filter above to narrow down.</td></tr>`;
  }

  tbody.innerHTML = html;
}

function filterPmCoverageTable() {
  const query = document.getElementById("pmClassSearchInput")?.value.toLowerCase().trim() || "";
  if (!query) {
    renderPmCoverageTable(pmAllClassesData);
    return;
  }
  const filtered = pmAllClassesData.filter(c =>
    c.title.toLowerCase().includes(query) ||
    c.module_name.toLowerCase().includes(query) ||
    c.track_name.toLowerCase().includes(query) ||
    c.program_name.toLowerCase().includes(query)
  );
  renderPmCoverageTable(filtered);
}

// Admin Curriculum Architecture Program & Track Sub-Tabs State
let adminFullTreeData = [];
let adminActiveProgramId = null;
let adminActiveTrackId = null;

async function loadAdminCurriculumArchitecture() {
  const container = document.getElementById("adminCurriculumTreeContainer");
  const progSubTabsNav = document.getElementById("adminCurriculumProgramSubTabs");
  const trackSubTabsNav = document.getElementById("adminCurriculumTrackSubTabs");
  if (!container) return;

  try {
    showLoader("Loading Curriculum Architecture...");
    const treeRes = await fetch(`${API_BASE}/curriculum/full-tree`);
    adminFullTreeData = await treeRes.json();

    if (!adminFullTreeData || adminFullTreeData.length === 0) {
      container.innerHTML = '<div style="color:var(--text-secondary); padding:20px;">No programs found in curriculum.</div>';
      if (progSubTabsNav) progSubTabsNav.innerHTML = '';
      if (trackSubTabsNav) trackSubTabsNav.innerHTML = '';
      return;
    }

    // Default to first program if none currently selected or selected ID no longer exists
    if (!adminActiveProgramId || !adminFullTreeData.some(p => p.id === adminActiveProgramId)) {
      adminActiveProgramId = adminFullTreeData[0].id;
    }

    const currentProg = adminFullTreeData.find(p => p.id === adminActiveProgramId);
    const progTracks = currentProg ? (currentProg.tracks || []) : [];
    if (!adminActiveTrackId || !progTracks.some(t => t.id === adminActiveTrackId)) {
      adminActiveTrackId = progTracks.length > 0 ? progTracks[0].id : null;
    }

    renderAdminProgramSubTabs();
    renderAdminTrackSubTabs();
    renderSelectedAdminTrackTree();
  } catch (err) {
    console.error("Error loading curriculum architecture:", err);
    container.innerHTML = `<div style="color:var(--danger-color); padding:16px;">Error loading curriculum: ${err.message}</div>`;
  } finally {
    hideLoader();
  }
}

window.loadAdminCurriculumArchitecture = loadAdminCurriculumArchitecture;

window.renderAdminProgramSubTabs = function () {
  const subTabsNav = document.getElementById("adminCurriculumProgramSubTabs");
  if (!subTabsNav) return;

  let html = "";
  adminFullTreeData.forEach(p => {
    const isActive = p.id === adminActiveProgramId;
    const trackCount = (p.tracks || []).length;
    const trackLabel = `${trackCount} ${trackCount === 1 ? 'Track' : 'Tracks'}`;

    const activeBtnStyle = isActive
      ? "background: var(--primary-accent, #0284c7) !important; color: #ffffff !important; border: 1px solid var(--primary-accent, #0284c7) !important; box-shadow: 0 2px 6px rgba(2,132,199,0.3) !important;"
      : "background: var(--bg-card, #ffffff) !important; color: var(--text-secondary, #475569) !important; border: 1px solid var(--border-subtle, #cbd5e1) !important;";

    const badgeStyle = isActive
      ? "background: rgba(255, 255, 255, 0.25) !important; color: #ffffff !important;"
      : "background: rgba(2, 132, 199, 0.1) !important; color: var(--primary-accent, #0284c7) !important;";

    html += `
      <button type="button" 
              class="admin-tab-btn program-subtab-btn ${isActive ? 'active' : ''}" 
              style="padding: 8px 16px !important; font-size: 0.85rem !important; font-weight: 600 !important; border-radius: 8px !important; cursor: pointer !important; transition: all 0.2s ease !important; display: inline-flex !important; align-items: center !important; gap: 8px !important; white-space: nowrap !important; flex-shrink: 0 !important; font-family: var(--font-sans, 'Inter', sans-serif) !important; ${activeBtnStyle}"
              onclick="selectAdminProgramSubTab(${p.id})">
        <span>${escapeHtml(p.name)}</span>
        <span class="badge-count" style="font-size: 0.72rem !important; padding: 2px 8px !important; border-radius: 12px !important; font-weight: 700 !important; ${badgeStyle}">
          ${trackLabel}
        </span>
      </button>
    `;
  });
  subTabsNav.innerHTML = html;
};

window.renderAdminTrackSubTabs = function () {
  const trackNav = document.getElementById("adminCurriculumTrackSubTabs");
  if (!trackNav) return;

  const prog = adminFullTreeData.find(p => p.id === adminActiveProgramId);
  if (!prog || !prog.tracks || prog.tracks.length === 0) {
    trackNav.innerHTML = '<span style="color:var(--text-secondary); font-size:0.84rem; padding:6px 0;">No tracks configured for this program.</span>';
    return;
  }

  // Ensure active track is valid for this program
  if (!adminActiveTrackId || !prog.tracks.some(t => t.id === adminActiveTrackId)) {
    adminActiveTrackId = prog.tracks[0].id;
  }

  let html = `<div style="display:flex; align-items:center; gap:8px; margin-right:8px; font-size:0.8rem; font-weight:700; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">Tracks:</div>`;
  prog.tracks.forEach(trk => {
    const isActive = trk.id === adminActiveTrackId;
    const modCount = (trk.modules || []).length;
    const modLabel = `${modCount} ${modCount === 1 ? 'Module' : 'Modules'}`;

    const activeBtnStyle = isActive
      ? "background: #0284c7 !important; color: #ffffff !important; border: 1px solid #0284c7 !important; box-shadow: 0 2px 6px rgba(2,132,199,0.35) !important;"
      : "background: var(--bg-card, #ffffff) !important; color: var(--text-secondary, #475569) !important; border: 1px solid var(--border-subtle, #cbd5e1) !important;";

    const badgeStyle = isActive
      ? "background: rgba(255, 255, 255, 0.25) !important; color: #ffffff !important;"
      : "background: rgba(2, 132, 199, 0.1) !important; color: var(--primary-accent, #0284c7) !important;";

    html += `
      <button type="button" 
              class="track-subtab-btn ${isActive ? 'active' : ''}" 
              style="padding: 7px 15px !important; font-size: 0.82rem !important; font-weight: 600 !important; border-radius: 6px !important; cursor: pointer !important; transition: all 0.2s ease !important; display: inline-flex !important; align-items: center !important; gap: 8px !important; font-family: var(--font-sans, 'Inter', sans-serif) !important; ${activeBtnStyle}"
              onclick="selectAdminTrackSubTab(${trk.id})">
        <span>${escapeHtml(trk.name)}</span>
        <span class="badge-count" style="font-size: 0.7rem !important; padding: 2px 7px !important; border-radius: 10px !important; font-weight: 700 !important; ${badgeStyle}">
          ${modLabel}
        </span>
      </button>
    `;
  });

  html += `
    <div style="margin-left: auto; display: flex; align-items: center; gap: 6px;">
      <button class="btn btn-primary" style="padding: 5px 12px; font-size: 0.78rem;" onclick="openAddTrackModal(${prog.id})">+ Add Track</button>
    </div>
  `;

  trackNav.innerHTML = html;
};

window.selectAdminProgramSubTab = function (progId) {
  adminActiveProgramId = progId;
  const prog = adminFullTreeData.find(p => p.id === progId);
  if (prog && prog.tracks && prog.tracks.length > 0) {
    adminActiveTrackId = prog.tracks[0].id;
  } else {
    adminActiveTrackId = null;
  }
  renderAdminProgramSubTabs();
  renderAdminTrackSubTabs();
  renderSelectedAdminTrackTree();
  if (prog) {
    recordClientActivity("Program Sub-Tab Selected", `Viewed curriculum program: ${prog.name}`);
  }
  const searchInput = document.getElementById("adminTreeSearchInput");
  if (searchInput && searchInput.value) {
    filterAdminTree(searchInput.value);
  }
};

window.selectAdminTrackSubTab = function (trackId) {
  adminActiveTrackId = trackId;
  renderAdminTrackSubTabs();
  renderSelectedAdminTrackTree();
  const prog = adminFullTreeData.find(p => p.id === adminActiveProgramId);
  const track = prog?.tracks?.find(t => t.id === trackId);
  if (track) {
    recordClientActivity("Track Sub-Tab Selected", `Switched to ${track.name} in ${prog.name}`);
  }
  const searchInput = document.getElementById("adminTreeSearchInput");
  if (searchInput && searchInput.value) {
    filterAdminTree(searchInput.value);
  }
};

window.renderSelectedAdminTrackTree = function () {
  const container = document.getElementById("adminCurriculumTreeContainer");
  if (!container) return;

  const prog = adminFullTreeData.find(p => p.id === adminActiveProgramId);
  if (!prog) {
    container.innerHTML = '<div style="color:var(--text-secondary); padding:16px;">Select a program sub-tab above to view its curriculum tracks.</div>';
    return;
  }

  const selectedTrack = (prog.tracks || []).find(t => t.id === adminActiveTrackId);
  if (!selectedTrack) {
    container.innerHTML = '<div style="color:var(--text-secondary); padding:16px;">Select a track sub-tab above to view its modules and classes.</div>';
    return;
  }

  // Build a single-track program representation to display exclusively this track's tree
  const singleTrackProgram = {
    ...prog,
    tracks: [selectedTrack]
  };

  renderCurriculumTree([singleTrackProgram], container);
};

window.renderSelectedAdminProgramTree = window.renderSelectedAdminTrackTree;

// Admin Dashboard Data Loader
async function loadAdminDashboardData() {
  try {
    showLoader("Loading Admin Architecture & Directory...");

    // 1. Load Curriculum Architecture with Program Sub-Tabs
    await loadAdminCurriculumArchitecture();

    // 2. Load User Governance Directory
    await renderAdminUsersTable();

  } catch (err) {
    console.error("Error loading Admin dashboard:", err);
  } finally {
    hideLoader();
  }
}

// Render Admin Users Table
async function renderAdminUsersTable() {
  const tbody = document.getElementById("adminUsersTableBody");
  if (!tbody) return;
  try {
    const res = await fetch(`${API_BASE}/users`);
    allUsers = await res.json();

    if (!allUsers || allUsers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-secondary); padding:16px;">No users found in directory.</td></tr>';
      return;
    }

    let rowsHtml = "";
    allUsers.forEach(u => {
      const roleTag = `<span class="role-tag-badge role-tag-${u.role}">${getRoleLabel(u.role)}</span>`;
      let progsHtml = "";
      if (u.role === "pm" || u.role === "admin") {
        progsHtml = `<span style="font-size:0.8rem; color:var(--text-muted); font-style:italic;">All Programs (${u.role === "pm" ? "LO Team Read-Only" : "Admin Full Access"})</span>`;
      } else {
        progsHtml = (u.program_names && u.program_names.length > 0)
          ? u.program_names.map(p => `<span class="program-tag-pill">${escapeHtml(p)}</span>`).join(" ")
          : `<span style="font-size:0.78rem; color:var(--danger-color);">No programs assigned</span>`;
      }

      rowsHtml += `
        <tr>
          <td style="font-family:var(--font-mono); font-size:0.8rem;">#${u.id}</td>
          <td style="font-weight:600;">${escapeHtml(u.name)}</td>
          <td style="color:var(--text-secondary); font-size:0.84rem;">${escapeHtml(u.email)}</td>
          <td>${roleTag}</td>
          <td><div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">${progsHtml}</div></td>
          <td>
            <div style="display:flex; gap:6px;">
              <button class="btn btn-secondary" style="padding:4px 10px; font-size:0.75rem;" onclick="openEditUserModal(${u.id})">Edit Scope</button>
              <button class="btn btn-warning" style="padding:4px 10px; font-size:0.75rem;" onclick="deleteUserDirectly(${u.id}, '${escapeHtml(u.name)}')">Delete</button>
            </div>
          </td>
        </tr>
      `;
    });
    tbody.innerHTML = rowsHtml;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--danger-color); padding:16px;">Error loading users: ${err.message}</td></tr>`;
  }
}

// User Management Modal Handlers (PRD Users & Roles)
window.openAddUserModal = async function () {
  document.getElementById("userManageModalTitle").textContent = "Add New User";
  document.getElementById("editUserId").value = "";
  document.getElementById("userNameInput").value = "";
  document.getElementById("userEmailInput").value = "";
  document.getElementById("userRoleInput").value = "sme";

  await renderProgramCheckboxes([]);
  document.getElementById("userManageModal").classList.remove("hidden");
};

window.openEditUserModal = async function (userId) {
  const u = allUsers.find(item => item.id === userId);
  if (!u) return;

  document.getElementById("userManageModalTitle").textContent = `Edit User Scope: ${u.name}`;
  document.getElementById("editUserId").value = u.id;
  document.getElementById("userNameInput").value = u.name;
  document.getElementById("userEmailInput").value = u.email;
  document.getElementById("userRoleInput").value = u.role;

  await renderProgramCheckboxes(u.program_ids || []);
  document.getElementById("userManageModal").classList.remove("hidden");
};

async function renderProgramCheckboxes(selectedIds = []) {
  const container = document.getElementById("userProgramCheckboxes");
  if (!container) return;

  if (!allSystemPrograms || allSystemPrograms.length === 0) {
    const res = await fetch(`${API_BASE}/programs`);
    allSystemPrograms = await res.json();
  }

  let html = "";
  allSystemPrograms.forEach(p => {
    const checked = selectedIds.includes(p.id) ? "checked" : "";
    html += `
      <label style="display:flex; align-items:center; gap:8px; font-size:0.85rem; color:var(--text-primary); cursor:pointer;">
        <input type="checkbox" class="user-prog-checkbox" value="${p.id}" ${checked}>
        <span>${escapeHtml(p.name)}</span>
      </label>
    `;
  });
  container.innerHTML = html;
}

window.onSaveUser = async function () {
  const userId = document.getElementById("editUserId").value;
  const name = document.getElementById("userNameInput").value.trim();
  const email = document.getElementById("userEmailInput").value.trim();
  const role = document.getElementById("userRoleInput").value;

  if (!name || !email) {
    alert("Please enter both Name and Email.");
    return;
  }

  const checkboxes = document.querySelectorAll(".user-prog-checkbox:checked");
  const progIds = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));

  try {
    showLoader("Saving User & Scope Configuration...");
    let res;
    if (userId) {
      res = await fetch(`${API_BASE}/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role, program_ids: progIds })
      });
    } else {
      res = await fetch(`${API_BASE}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, role, program_ids: progIds })
      });
    }

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to save user");
    }

    const savedUser = await res.json();
    document.getElementById("userManageModal").classList.add("hidden");

    // Refresh user list and selectors
    const uRes = await fetch(`${API_BASE}/users`);
    allUsers = await uRes.json();

    const userSelect = document.getElementById("activeUserSelector");
    if (userSelect) {
      userSelect.innerHTML = "";
      allUsers.forEach(u => {
        userSelect.innerHTML += `<option value="${u.id}">${escapeHtml(u.name)} (${getRoleLabel(u.role)})</option>`;
      });
      userSelect.value = currentUser ? currentUser.id : savedUser.id;
    }

    await renderAdminUsersTable();

    // If edited user is current user, update badge and scope tags
    if (currentUser && currentUser.id === savedUser.id) {
      await switchActiveUser(savedUser.id, false);
    }

    alert(`User '${savedUser.name}' saved successfully.`);
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    hideLoader();
  }
};

window.deleteUserDirectly = async function (userId, userName) {
  // Use the curriculum confirm modal pattern instead of browser confirm()
  document.getElementById("confirmDeleteType").value = "user";
  document.getElementById("confirmDeleteId").value = userId;
  document.getElementById("curriculumConfirmTitle").textContent = "Remove User";
  document.getElementById("curriculumConfirmMessage").textContent = `Are you sure you want to permanently remove user '${userName}' from the platform?`;
  document.getElementById("curriculumConfirmDeleteBtn").textContent = "Remove User";
  document.getElementById("curriculumConfirmModal").classList.remove("hidden");
};

// Read-Only Script Inspection Modal
window.viewScriptReadonly = async function (scriptId) {
  try {
    showLoader("Fetching Script in Read-Only Mode...");
    const res = await fetch(`${API_BASE}/scripts/${scriptId}`);
    if (!res.ok) throw new Error("Could not load script details.");
    const script = await res.json();

    const titleEl = document.getElementById("assignmentsModalTitle");
    const bodyEl = document.getElementById("assignmentsContent");

    titleEl.textContent = `Script Inspection: ${script.class_title} [${script.status}]`;

    const isApproved = (script.status === "GTG");
    const gtgButtonHtml = isApproved
      ? `<span class="status-pill status-gtg" style="padding: 5px 12px; font-size: 0.8rem; font-weight: 600;">Official GTG Approved</span>`
      : `<button id="inspectGtgBtn-${script.id}" class="btn btn-success" style="padding: 5px 12px; font-size: 0.8rem;" onclick="approveScriptDirectly(${script.id}, this)">Approve GTG</button>`;

    let contentHtml = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--border-subtle); flex-wrap:wrap; gap:8px;">
        <div>
          <span id="inspectModalStatusPill" style="font-weight:700; color:var(--primary-glow);">${script.status}</span> &bull; 
          <span>${script.duration_minutes} Minutes</span> &bull; 
          <span>${script.cards ? script.cards.length : 0} Spoken Cards</span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <button class="btn btn-secondary" style="padding: 5px 12px; font-size: 0.8rem;" onclick="navigator.clipboard.writeText(window.location.origin + '/script/' + '${script.uuid}'); alert('Permalink copied!');">Copy Shareable Link</button>
          ${currentUser && (currentUser.role === 'admin' || currentUser.role === 'mo' || (currentUser.role === 'sme' && script.user_id === currentUser.id)) ? `<button class="btn btn-warning" style="padding: 5px 12px; font-size: 0.8rem; background:rgba(239,68,68,0.12); color:var(--danger-color); border:1px solid rgba(239,68,68,0.3);" onclick="deleteScriptDirectly(${script.id}, '${escapeHtml(script.class_title)}')">Delete Script</button>` : ''}
          ${currentUser && (currentUser.role === 'mo' || currentUser.role === 'admin') ? gtgButtonHtml : ''}
        </div>
      </div>
      <div style="display:flex; flex-direction:column; gap:16px;">
    `;

    (script.cards || []).forEach(c => {
      contentHtml += `
        <div style="border:1px solid var(--border-subtle); border-radius:8px; padding:16px; background:var(--bg-card);">
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span style="font-weight:700; color:var(--text-primary);">Card #${c.card_index}: ${escapeHtml(c.title)}</span>
            <span style="font-size:0.8rem; color:var(--text-secondary);">${c.duration_mins} mins</span>
          </div>
          ${c.stage_directions ? `<div style="font-size:0.8rem; color:var(--purple-accent); font-style:italic; margin-bottom:8px;">${escapeHtml(c.stage_directions)}</div>` : ''}
          <div style="font-size:0.88rem; color:var(--text-primary); line-height:1.6; white-space:pre-wrap;">${escapeHtml(c.content_script)}</div>
          ${c.code_snippet ? `<pre style="background:var(--bg-main); padding:10px; border-radius:6px; margin-top:10px; font-family:monospace; font-size:0.8rem; overflow-x:auto;"><code>${escapeHtml(c.code_snippet)}</code></pre>` : ''}
        </div>
      `;
    });

    contentHtml += '</div>';
    bodyEl.innerHTML = contentHtml;

    document.getElementById("assignmentsModal").classList.remove("hidden");

  } catch (err) {
    alert("Error inspecting script: " + err.message);
  } finally {
    hideLoader();
  }
};

// Permanent Script Deletion Handler
window.deleteScriptDirectly = async function (scriptId, scriptTitle) {
  const confirmed = confirm(`Are you sure you want to permanently delete script #${scriptId} ("${scriptTitle || 'Selected Script'}")?\n\nThis will remove all associated script cards, stage directions, and approval records.`);
  if (!confirmed) return;

  try {
    showLoader("Deleting Script...");
    const userParam = currentUser ? `?user_id=${currentUser.id}` : "";
    const res = await fetch(`${API_BASE}/scripts/${scriptId}${userParam}`, {
      method: "DELETE"
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Failed to delete script");
    }

    const data = await res.json();

    // Close inspection modal if currently open
    const inspectModal = document.getElementById("assignmentsModal");
    if (inspectModal && !inspectModal.classList.contains("hidden")) {
      inspectModal.classList.add("hidden");
    }

    // Refresh Admin Scripts table if function exists
    if (typeof loadAdminScriptsTable === "function") {
      await loadAdminScriptsTable();
    }

    // Refresh SME program scripts table if function exists
    if (typeof refreshCurrentProgramScripts === "function") {
      refreshCurrentProgramScripts();
    }

    // Refresh PM table if function exists
    if (typeof loadPmDashboardData === "function") {
      loadPmDashboardData();
    }

    alert(data.message || `Script #${scriptId} deleted successfully.`);
  } catch (err) {
    alert("Error deleting script: " + err.message);
  } finally {
    hideLoader();
  }
};

// ==============================================================================
// 11. EMAIL SIGN-IN & AUTH FLOW
// ==============================================================================

window.openEmailLoginModal = function () {
  const modal = document.getElementById("emailLoginModal");
  if (modal) {
    modal.classList.remove("hidden");
    const input = document.getElementById("emailLoginInput");
    if (input) {
      input.value = currentUser ? currentUser.email : "";
      setTimeout(() => input.focus(), 100);
    }
  }
};

window.closeEmailLoginModal = function () {
  const modal = document.getElementById("emailLoginModal");
  if (modal) modal.classList.add("hidden");
};

window.fillEmailLogin = function (email) {
  const input = document.getElementById("emailLoginInput");
  if (input) input.value = email;
};

window.submitEmailLogin = async function () {
  const input = document.getElementById("emailLoginInput");
  const email = input ? input.value.trim().toLowerCase() : "";
  if (!email) {
    alert("Please enter a valid work email address.");
    return;
  }

  // Ensure allUsers is loaded
  if (!allUsers || allUsers.length === 0) {
    const res = await fetch(`${API_BASE}/users`);
    allUsers = await res.json();
  }

  const user = allUsers.find(u => u.email.toLowerCase() === email);
  if (!user) {
    alert(`No user found with email '${email}'. Please verify your email or ask the Administrator to enroll your profile.`);
    return;
  }

  closeEmailLoginModal();
  showLoader(`Signing in as ${user.name} (${getRoleLabel(user.role)})...`);
  try {
    await switchActiveUser(user.id, true);
  } finally {
    hideLoader();
  }
};

// ==============================================================================
// 12. ADMIN GOVERNANCE CONSOLE - TABS & PROGRAM / TRACK / LEVEL MANAGEMENT
// ==============================================================================

window.switchAdminTab = function (tabName) {
  const tabs = ["users", "curriculum", "scripts", "activities"];
  tabs.forEach(t => {
    let btnId = "adminTabBtnUsers";
    let panelId = "adminTabUsers";
    if (t === "curriculum") {
      btnId = "adminTabBtnCurriculum";
      panelId = "adminTabCurriculum";
    } else if (t === "scripts") {
      btnId = "adminTabBtnScripts";
      panelId = "adminTabScripts";
    } else if (t === "activities") {
      btnId = "adminTabBtnActivities";
      panelId = "adminTabActivities";
    }

    const btn = document.getElementById(btnId);
    const panel = document.getElementById(panelId);

    if (btn) {
      if (t === tabName) btn.classList.add("active");
      else btn.classList.remove("active");
    }
    if (panel) {
      if (t === tabName) panel.classList.remove("hidden");
      else panel.classList.add("hidden");
    }
  });

  if (tabName === "users") {
    renderAdminUsersTable();
    recordClientActivity("Tab Switched", "Navigated to Users & SME Enrollment tab");
  } else if (tabName === "curriculum") {
    loadAdminCurriculumArchitecture();
    recordClientActivity("Tab Switched", "Navigated to Curriculum Architecture tab");
  } else if (tabName === "scripts") {
    loadAdminScriptsTable();
    recordClientActivity("Tab Switched", "Navigated to Generated Scripts & Approvals audit tab");
  } else if (tabName === "activities") {
    loadUserActivities();
  }
};

let adminLoadedScripts = [];

function formatAuditDateTime(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
  } catch (e) {
    return dateStr;
  }
}

window.loadAdminScriptsTable = async function () {
  const tbody = document.getElementById("adminScriptsTableBody");
  if (!tbody) return;

  try {
    showLoader("Loading Generated Scripts & Approvals Audit...");
    const res = await fetch(`${API_BASE}/dashboard/scripts`);
    if (!res.ok) throw new Error("Could not fetch generated scripts.");
    adminLoadedScripts = await res.json();

    // Populate Program Filter Options dynamically
    const progFilter = document.getElementById("adminScriptsProgramFilter");
    if (progFilter) {
      const selectedProg = progFilter.value;
      const programsMap = new Map();
      adminLoadedScripts.forEach(s => {
        if (s.program_id && s.program_name) {
          programsMap.set(String(s.program_id), s.program_name);
        }
      });
      progFilter.innerHTML = '<option value="">All Programs</option>';
      programsMap.forEach((pName, pId) => {
        const opt = document.createElement("option");
        opt.value = pId;
        opt.textContent = pName;
        progFilter.appendChild(opt);
      });
      progFilter.value = selectedProg || "";
    }

    // Update KPI counts
    const totalCountEl = document.getElementById("adminTotalScriptsCount");
    const gtgCountEl = document.getElementById("adminGtgScriptsCount");
    const wipCountEl = document.getElementById("adminWipScriptsCount");
    const activeSmesEl = document.getElementById("adminActiveSmesCount");
    const totalMosEl = document.getElementById("adminTotalMosCount");
    const totalPmsEl = document.getElementById("adminTotalPmsCount");

    const gtgCount = adminLoadedScripts.filter(s => s.status === "GTG").length;
    const wipCount = adminLoadedScripts.filter(s => s.status !== "GTG").length;
    const smesSet = new Set(adminLoadedScripts.map(s => s.sme_name).filter(Boolean));

    if (totalCountEl) totalCountEl.textContent = adminLoadedScripts.length;
    if (gtgCountEl) gtgCountEl.textContent = gtgCount;
    if (wipCountEl) wipCountEl.textContent = wipCount;
    if (activeSmesEl) activeSmesEl.textContent = smesSet.size;

    // Fetch and calculate dynamic MO and PM counts
    try {
      const uRes = await fetch(`${API_BASE}/users`);
      if (uRes.ok) {
        const usersList = await uRes.json();
        allUsers = usersList;
        const mosCount = usersList.filter(u => u.role === "mo").length;
        const pmsCount = usersList.filter(u => u.role === "pm").length;
        if (totalMosEl) totalMosEl.textContent = mosCount;
        if (totalPmsEl) totalPmsEl.textContent = pmsCount;
      }
    } catch (uErr) {
      console.warn("Could not fetch user directory for MO/PM counts:", uErr);
    }

    filterAdminScriptsTable();
  } catch (err) {
    console.error("Error loading admin scripts table:", err);
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--danger-color); padding:20px;">Failed to load scripts: ${escapeHtml(err.message)}</td></tr>`;
  } finally {
    hideLoader();
  }
};

window.filterAdminScriptsTable = function () {
  const tbody = document.getElementById("adminScriptsTableBody");
  if (!tbody) return;

  const searchQuery = (document.getElementById("adminScriptsSearchInput")?.value || "").toLowerCase().trim();
  const selectedProg = document.getElementById("adminScriptsProgramFilter")?.value || "";
  const selectedStatus = document.getElementById("adminScriptsStatusFilter")?.value || "";

  let filtered = adminLoadedScripts || [];

  if (selectedProg) {
    filtered = filtered.filter(s => String(s.program_id) === String(selectedProg));
  }

  if (selectedStatus) {
    if (selectedStatus === "GTG") {
      filtered = filtered.filter(s => s.status === "GTG");
    } else {
      filtered = filtered.filter(s => s.status !== "GTG");
    }
  }

  if (searchQuery) {
    filtered = filtered.filter(s =>
      (s.sme_name && s.sme_name.toLowerCase().includes(searchQuery)) ||
      (s.class_title && s.class_title.toLowerCase().includes(searchQuery)) ||
      (s.module_name && s.module_name.toLowerCase().includes(searchQuery)) ||
      (s.track_name && s.track_name.toLowerCase().includes(searchQuery)) ||
      (s.program_name && s.program_name.toLowerCase().includes(searchQuery)) ||
      (s.approved_by_name && s.approved_by_name.toLowerCase().includes(searchQuery)) ||
      (String(s.id).includes(searchQuery))
    );
  }

  renderAdminScriptsTable(filtered);
};

window.renderAdminScriptsTable = function (scripts) {
  const tbody = document.getElementById("adminScriptsTableBody");
  if (!tbody) return;

  if (!scripts || scripts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--text-secondary); padding:24px;">No generated scripts match your search/filter criteria.</td></tr>';
    return;
  }

  let html = "";
  scripts.forEach(s => {
    const isGtg = s.status === "GTG";
    const statusPill = isGtg
      ? '<span class="status-pill status-gtg">GTG Approved</span>'
      : '<span class="status-pill status-wip">Script WIP</span>';

    const smeBadge = `<span style="font-weight:600; color:var(--primary-accent); background:rgba(2,132,199,0.12); padding:3px 9px; border-radius:12px; font-size:0.78rem; display:inline-block;">${escapeHtml(s.sme_name || 'Aryan (SME)')}</span>`;

    const generatedAtFormatted = formatAuditDateTime(s.created_at) || 'Just now';

    let approvedAtHtml = "";
    let approvedByHtml = "";
    if (isGtg) {
      approvedAtHtml = `<span style="font-weight:600; color:var(--success-color); font-size:0.8rem;">${formatAuditDateTime(s.approved_at) || 'Approved'}</span>`;
      approvedByHtml = `<span style="font-weight:500; color:var(--text-primary); font-size:0.8rem;">${escapeHtml(s.approved_by_name || 'Rohan Gupta (MO)')}</span>`;
    } else {
      approvedAtHtml = `<span style="color:#d97706; background:rgba(217,119,6,0.12); padding:2px 8px; border-radius:10px; font-size:0.74rem; font-weight:600;">Pending MO Sign-off</span>`;
      approvedByHtml = `<span style="color:var(--text-muted); font-size:0.8rem;">-</span>`;
    }

    html += `
      <tr>
        <td style="font-weight:700; color:var(--text-secondary); font-size:0.85rem;">#${s.id}</td>
        <td>
          <div style="font-weight:600; color:var(--text-primary); font-size:0.85rem;">${escapeHtml(s.program_name)}</div>
          <div style="font-size:0.76rem; color:var(--text-muted); margin-top:2px;">${escapeHtml(s.track_name)}</div>
        </td>
        <td>
          <div style="font-weight:600; color:var(--text-primary); font-size:0.88rem;">${escapeHtml(s.class_title)}</div>
          <div style="font-size:0.76rem; color:var(--text-muted); margin-top:2px;">Module: ${escapeHtml(s.module_name)} &bull; ${s.duration_minutes}m</div>
        </td>
        <td>${smeBadge}</td>
        <td>
          <div style="font-size:0.82rem; font-weight:500; color:var(--text-primary);">${generatedAtFormatted}</div>
        </td>
        <td>${approvedAtHtml}</td>
        <td>${approvedByHtml}</td>
        <td>${statusPill}</td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-secondary" style="padding:4px 8px; font-size:0.75rem;" onclick="viewScriptReadonly(${s.id})">Inspect</button>
            <button class="btn btn-ghost" style="padding:4px 8px; font-size:0.75rem;" onclick="navigator.clipboard.writeText(window.location.origin + '/script/' + '${s.uuid}'); alert('Script link copied to clipboard!');">Link</button>
            <button class="btn btn-warning" style="padding:4px 8px; font-size:0.75rem; background:rgba(239,68,68,0.12); color:var(--danger-color); border:1px solid rgba(239,68,68,0.3);" onclick="deleteScriptDirectly(${s.id}, '${escapeHtml(s.class_title)}')">Delete</button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
};

// Toggle Module Lock Status (PRD FR-1)
window.toggleModuleLock = async function (modId, currentLockStatus) {
  try {
    showLoader("Updating Module Lock Status...");
    const userParam = currentUser ? `?user_id=${currentUser.id}` : "";
    const res = await fetch(`${API_BASE}/modules/${modId}${userParam}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_locked: !currentLockStatus })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Failed to toggle module lock status");
    }
    await refreshCurriculumDataGlobally();
    alert(`Module is now ${!currentLockStatus ? "Locked" : "Unlocked"}.`);
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    hideLoader();
  }
};

// Reassign Module to Different Track / Proficiency Level
window.reassignModuleTrack = async function (modId, currentTrackId) {
  try {
    showLoader("Fetching available tracks...");
    const userParam = (currentUser && currentUser.role === "mo") ? `?user_id=${currentUser.id}` : "";
    const treeRes = await fetch(`${API_BASE}/curriculum/full-tree${userParam}`);
    const tree = await treeRes.json();

    const sel = document.getElementById("reassignTrackSelect");
    sel.innerHTML = "";
    tree.forEach(p => {
      const grp = document.createElement("optgroup");
      grp.label = p.name;
      (p.tracks || []).forEach(t => {
        const opt = document.createElement("option");
        opt.value = t.id;
        opt.textContent = t.name;
        if (t.id === currentTrackId) opt.disabled = true;
        grp.appendChild(opt);
      });
      sel.appendChild(grp);
    });

    document.getElementById("reassignModuleId").value = modId;
    document.getElementById("reassignTrackModal").classList.remove("hidden");
  } catch (err) {
    alert("Error loading tracks: " + err.message);
  } finally {
    hideLoader();
  }
};

window.confirmReassignModuleTrack = async function () {
  const modId = document.getElementById("reassignModuleId").value;
  const targetId = parseInt(document.getElementById("reassignTrackSelect").value, 10);
  if (!targetId) { alert("Please select a target track."); return; }

  try {
    showLoader("Reassigning Module...");
    document.getElementById("reassignTrackModal").classList.add("hidden");
    const param = currentUser ? `?user_id=${currentUser.id}` : "";
    const res = await fetch(`${API_BASE}/modules/${modId}${param}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ track_id: targetId })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || "Failed to reassign module");
    }
    await refreshCurriculumDataGlobally();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    hideLoader();
  }
};

// ==============================================================================
// 13. USER ACTIVITY STICKY NOTES BOARD
// ==============================================================================

let adminAllActivities = [];

async function loadUserActivities() {
  const tbody = document.getElementById("adminActivitiesTableBody");
  if (!tbody) return;

  try {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-secondary); padding:24px;">Fetching latest user activities...</td></tr>';
    const res = await fetch(`${API_BASE}/activities?limit=100`);
    if (!res.ok) throw new Error("Failed to load activities");
    adminAllActivities = await res.json();
    renderActivitiesTable(adminAllActivities);
  } catch (err) {
    console.error("Error loading activities:", err);
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--danger-color); padding:20px;">Failed to load user activities: ${err.message}</td></tr>`;
  }
}

window.loadUserActivities = loadUserActivities;

function formatActivityDate(dateStr) {
  if (!dateStr) return { date: "Today", time: "" };
  try {
    // If dateStr ends without Z and has no timezone offset, append Z if it is from UTC
    let normalized = dateStr;
    if (typeof dateStr === "string" && !dateStr.endsWith("Z") && !dateStr.includes("+")) {
      normalized = dateStr.includes("T") ? dateStr + "Z" : dateStr.replace(" ", "T") + "Z";
    }
    const d = new Date(normalized);
    if (isNaN(d.getTime())) {
      const fallback = new Date(dateStr);
      if (isNaN(fallback.getTime())) return { date: dateStr, time: "" };
      return {
        date: fallback.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        time: fallback.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true })
      };
    }
    const dateFormatted = d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
    const timeFormatted = d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
    return { date: dateFormatted, time: timeFormatted };
  } catch {
    return { date: dateStr, time: "" };
  }
}

function renderActivitiesTable(activities) {
  const tbody = document.getElementById("adminActivitiesTableBody");
  if (!tbody) return;

  if (!activities || activities.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-secondary); padding:24px; font-style:italic;">No user activities found.</td></tr>';
    return;
  }

  let html = "";
  activities.forEach(act => {
    const { date, time } = formatActivityDate(act.created_at);
    const roleTag = `<span class="role-tag-badge role-tag-${act.user_role || 'sme'}">${(act.user_role || 'User').toUpperCase()}</span>`;

    // Action badge style without emojis
    let actionBadge = `<span style="font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:6px; background:rgba(2,132,199,0.12); color:var(--primary-accent);">${escapeHtml(act.action_type || 'Activity')}</span>`;
    const aType = (act.action_type || "").toLowerCase();
    if (aType.includes("gtg") || aType.includes("approv")) {
      actionBadge = `<span style="font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:6px; background:rgba(16,185,129,0.15); color:var(--success-color); border:1px solid rgba(16,185,129,0.3);">${escapeHtml(act.action_type)}</span>`;
    } else if (aType.includes("delete")) {
      actionBadge = `<span style="font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:6px; background:rgba(239,68,68,0.15); color:var(--danger-color); border:1px solid rgba(239,68,68,0.3);">${escapeHtml(act.action_type)}</span>`;
    } else if (aType.includes("script")) {
      actionBadge = `<span style="font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:6px; background:rgba(99,102,241,0.15); color:#6366f1; border:1px solid rgba(99,102,241,0.3);">${escapeHtml(act.action_type)}</span>`;
    } else if (aType.includes("login") || aType.includes("sign-in")) {
      actionBadge = `<span style="font-size:0.75rem; font-weight:700; padding:2px 8px; border-radius:6px; background:rgba(245,158,11,0.15); color:#d97706; border:1px solid rgba(245,158,11,0.3);">${escapeHtml(act.action_type)}</span>`;
    }

    html += `
      <tr>
        <td style="font-family:var(--font-mono); font-size:0.8rem; color:var(--text-secondary);">#${act.id}</td>
        <td style="font-weight:600; color:var(--text-primary);">${escapeHtml(act.user_name || 'System User')}</td>
        <td>${roleTag}</td>
        <td>${actionBadge}</td>
        <td style="color:var(--text-primary); font-size:0.86rem; line-height:1.4;">${escapeHtml(act.description || '')}</td>
        <td style="font-size:0.82rem; color:var(--text-secondary); white-space:nowrap;">${date}</td>
        <td style="font-size:0.82rem; color:var(--text-secondary); white-space:nowrap;">${time}</td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

window.renderActivitiesTable = renderActivitiesTable;

window.filterAdminActivities = function () {
  const searchInput = document.getElementById("adminActivitySearchInput");
  const roleFilter = document.getElementById("adminActivityRoleFilter");
  const q = (searchInput ? searchInput.value : "").trim().toLowerCase();
  const selectedRole = (roleFilter ? roleFilter.value : "").trim().toLowerCase();

  const filtered = adminAllActivities.filter(act => {
    const matchesSearch = !q || 
      (act.user_name && act.user_name.toLowerCase().includes(q)) ||
      (act.description && act.description.toLowerCase().includes(q)) ||
      (act.action_type && act.action_type.toLowerCase().includes(q)) ||
      (act.created_at && act.created_at.toLowerCase().includes(q));

    const matchesRole = !selectedRole || 
      (act.user_role && act.user_role.toLowerCase() === selectedRole);

    return matchesSearch && matchesRole;
  });

  renderActivitiesTable(filtered);
};

// Global helper to post activities dynamically from client actions (e.g. login, export)
async function recordClientActivity(actionType, description) {
  if (!currentUser) return;
  try {
    await fetch(`${API_BASE}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_name: currentUser.name || "User",
        user_role: currentUser.role || "user",
        action_type: actionType,
        description: description
      })
    });
  } catch (e) {
    // Silent fail for telemetry
    console.debug("Activity log skipped:", e);
  }
}

window.recordClientActivity = recordClientActivity;

