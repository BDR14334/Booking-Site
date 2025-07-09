console.log("authStatus.js loaded");

// Use local backend if running locally, otherwise use deployed backend
const API_BASE = window.location.hostname === "localhost"
  ? "http://localhost:5000"
  : "https://booking-site-rz5b.onrender.com";

// === Global Functions ===

// Sidebar toggle function
function toggleSidebar() {
  const sidebar = document.getElementById("profileSidebar");
  sidebar.style.display = sidebar.style.display === "block" ? "none" : "block";
}

// Logout function
function handleLogout() {
  console.log("Logout clicked");
  fetch(`${API_BASE}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  })
  .then(res => res.json())
  .then(() => {
    window.location.reload();
  });
}

// Function to build sidebar links based on role
function buildSidebarLinks(role) {
  const sidebarLinksContainer = document.getElementById("sidebarLinksContainer");

  // Clear previous links except Logout link
  sidebarLinksContainer.innerHTML = '';

  // Create new links based on the role
  if (role === "admin") {
    sidebarLinksContainer.insertAdjacentHTML('beforeend', `
      <a href="AdminDashboard.html" class="text-white px-3 py-2 text-decoration-none">📊 Admin Dashboard</a>
    `);
  } else if (role === "coach") {
    sidebarLinksContainer.insertAdjacentHTML('beforeend', `
      <a href="CoachDashboard.html#editCoachInfo" class="text-white px-3 py-2 text-decoration-none">📋 Edit Info</a>
      <a href="CoachDashboard.html#editAvailability" class="text-white px-3 py-2 text-decoration-none">🕑 Edit Availability</a>
      <a href="CoachDashboard.html#coachBookings" class="text-white px-3 py-2 text-decoration-none">📅 View Bookings</a>
    `);
  } else if (role === "athlete") {
    sidebarLinksContainer.insertAdjacentHTML('beforeend', `
      <a href="AthleteDashboard.html#editInfo" class="text-white px-3 py-2 text-decoration-none">📋 Edit Info</a>
      <a href="AthleteDashboard.html#athleteInfo" class="text-white px-3 py-2 text-decoration-none">➕ Add Athlete</a>
      <a href="AthleteDashboard.html#viewSessions" class="text-white px-3 py-2 text-decoration-none">📅 View Sessions</a>
      <a href="AthleteDashboard.html#receipts" class="text-white px-3 py-2 text-decoration-none">🧾 Receipts</a>
    `);
  }
}

// Function to fetch user details from the backend (verify endpoint)
async function getUserDetails() {
  try {
    const response = await fetch(`${API_BASE}/auth/verify`, {
      method: 'GET',
      credentials: 'include'
    });

    const data = await response.json();

    const userRole = document.getElementById('userRole');
    if (data.loggedIn) {
      const firstName = data.user.first_name;
      if (userRole && firstName) {
        userRole.innerHTML = `Welcome, <span class="user-name">${firstName}</span>`;
      }
    } else {
      // Clear the userRole element when not logged in
      if (userRole) {
        userRole.innerHTML = "";
      }
      console.log('User not logged in');
    }
  } catch (error) {
    console.error('Error fetching user details:', error);
  }
}

// Function to update navigation button and sidebar based on authentication status
function updateNavButton() {
  const navButton = document.getElementById('authButtons');
  const sidebarLinksContainer = document.getElementById("sidebarLinksContainer");

  if (!navButton || !sidebarLinksContainer) return;

  // Clear UI first to prevent stale content
  navButton.innerHTML = "";
  sidebarLinksContainer.innerHTML = "";

  // Determine screen width
  const isMobile = window.innerWidth < 824;

  // Add a cache-busting query param to prevent browser from reusing old fetch result
  fetch(`${API_BASE}/auth/verify?_=${Date.now()}`, {
    method: 'GET',
    credentials: 'include',
  })
    .then(res => res.json())
    .then(data => {
      if (data.loggedIn) {
        // Show profile icon (mobile) or role name (desktop)
        navButton.innerHTML = isMobile
          ? `<button class="profile-btn" id="profileBtn"><i class='bx bx-user'></i></button>`
          : `<button class="profile-btn" id="profileBtn"><i class='bx bx-user'></i></button>`;

        buildSidebarLinks(data.user.role.toLowerCase());
        getUserDetails();

        const profileBtn = document.getElementById('profileBtn');
        profileBtn?.addEventListener('click', toggleSidebar);

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
          logoutBtn.style.display = "block";
          logoutBtn.onclick = handleLogout;
        }

      } else {
        // Not logged in
        if (isMobile) {
          navButton.innerHTML = `
            <button class="profile-btn" id="profileBtn"><i class='bx bx-user'></i></button>
          `;

          sidebarLinksContainer.innerHTML = `
            <a class="sidebar-link-margin text-white px-3 py-2 text-decoration-none" href="Login.html">🔑 Login</a>
            <a class="text-white px-3 py-2 text-decoration-none" href="Login.html?register">📝 Register</a>
          `;

          document.getElementById('profileBtn')?.addEventListener('click', toggleSidebar);
        } else {
          navButton.innerHTML = `
            <button class="btn${activeForm === "login" ? " white-btn" : ""}" id="loginBtn" onclick="login()">Login</button>
            <button class="btn${activeForm === "register" ? " white-btn" : ""}" id="registerBtn" onclick="register()">Register</button>
          `;

          document.getElementById('loginBtn').onclick = login;
          document.getElementById('registerBtn').onclick = register;
        }

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
          logoutBtn.style.display = "none";
        }
      }
    })
    .catch(err => {
      console.error("Auth check failed:", err);
    });
}

// Track last known isMobile state to avoid unnecessary updates
let lastIsMobile = window.innerWidth < 824;

window.addEventListener('resize', () => {
  const isMobile = window.innerWidth < 824;
  if (isMobile !== lastIsMobile) {
    updateNavButton();
    lastIsMobile = isMobile;
  }
});

// Run when DOM is first loaded
document.addEventListener('DOMContentLoaded', updateNavButton);

// Also run when user returns to page (e.g., using back button)
window.addEventListener('pageshow', updateNavButton);

// Optional: In case of tab visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    updateNavButton();
  }
});

// Add this to your Login.html script
document.addEventListener("DOMContentLoaded", () => {
  if (window.location.search.includes("register")) {
    register();
  }
});

let activeForm = "login"; // default to login

function login() {
    activeForm = "login";
    document.getElementById("login").classList.add("active");
    document.getElementById("register").classList.remove("active");
    updateNavButton(); // <-- re-render nav buttons with correct highlight
}

function register() {
    activeForm = "register";
    document.getElementById("login").classList.remove("active");
    document.getElementById("register").classList.add("active");
    updateNavButton(); // <-- re-render nav buttons with correct highlight
}

function updateAuthButtonClasses() {
    const loginBtn = document.getElementById("loginBtn");
    const registerBtn = document.getElementById("registerBtn");
    if (loginBtn && registerBtn) {
        if (activeForm === "login") {
            loginBtn.classList.add("white-btn");
            registerBtn.classList.remove("white-btn");
        } else {
            loginBtn.classList.remove("white-btn");
            registerBtn.classList.add("white-btn");
        }
    }
}
