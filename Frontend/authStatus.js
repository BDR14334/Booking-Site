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
      credentials: 'include' // Ensure cookies are sent with the request
    });
    
    const data = await response.json();
    
    if (data.loggedIn) {
      // Successfully verified the user, populate user info
      const firstName = data.user.first_name;
      
      // Fill the sidebar with the user's name
      const userRole = document.getElementById('userRole');
      if (userRole && firstName) {
        userRole.innerHTML = `Welcome, <span class="user-name">${firstName}</span>`;
      }
    } else {
      console.log('User not logged in');
    }
  } catch (error) {
    console.error('Error fetching user details:', error);
  }
}

// === DOM Content Loaded Event ===
document.addEventListener('DOMContentLoaded', () => {
  // Fetch login status from server
  fetch(`${API_BASE}/auth/verify`, {
    method: 'GET',
    credentials: 'include',
  })
  .then(res => res.json())
  .then(data => {
    const navButton = document.getElementById('authButtons');

    if (data.loggedIn) {
      const { role, first_name } = data.user;

      // Replace login/register buttons with profile button
      navButton.innerHTML = `
        <button class="btn profile-btn" id="profileBtn">${role.charAt(0).toUpperCase() + role.slice(1)}</button><!--<br>Dashboard-->
      `;

      // Fill sidebar user info
      const userRole = document.getElementById('userRole');
      if (userRole) {
        userRole.innerText = `Welcome, ${first_name}`;
      }

      // Build sidebar links
      buildSidebarLinks(role.toLowerCase());

      // Hook up sidebar toggle
      const profileBtn = document.getElementById('profileBtn');
      profileBtn?.addEventListener('click', toggleSidebar);

      // Hook up logout
      const logoutBtn = document.getElementById('logoutBtn');
      logoutBtn?.addEventListener('click', handleLogout);

      // Call getUserDetails to populate sidebar with user info
      getUserDetails();
    } else {
      // Not logged in: show login/register buttons and attach handlers
      navButton.innerHTML = `
        <button class="btn white-btn" id="loginBtn">Login</button>
        <button class="btn" id="registerBtn">Register</button>
      `;
      // Attach handlers in JS so they always work
      document.getElementById('loginBtn').onclick = function() {
        window.location.href = "login.html";
      };
      document.getElementById('registerBtn').onclick = function() {
        window.location.href = "login.html?register=true";
      };
    }
  })
  .catch(err => console.error('Verification error:', err));
});
