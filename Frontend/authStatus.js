document.addEventListener('DOMContentLoaded', () => {
    fetch('http://localhost:5000/auth/verify', {
      method: 'GET',
      credentials: 'include', // Send cookies with the request
    })
      .then(res => res.json())
      .then(data => {
        const navButton = document.querySelector('.nav-button');
        if (data.loggedIn) {
          const { role, email } = data.user;
          navButton.innerHTML = `
            <div class="profile-dropdown">
              <button class="btn profile-btn">${role.charAt(0).toUpperCase() + role.slice(1)}</button>
              <div class="dropdown-content" id="dropdownMenu">
                <a href="#">Profile (${email})</a>
                <a href="#" id="logoutBtn">Logout</a>
              </div>
            </div>
          `;
          document.getElementById('logoutBtn').addEventListener('click', handleLogout);
          document.querySelector('.profile-btn').addEventListener('click', toggleDropdown);
        }
      })
      .catch(err => {
        console.error('Verification error:', err);
      });
});

function handleLogout() {
    fetch('http://localhost:5000/auth/logout', {
      method: 'POST',
      credentials: 'include', // Send cookies with the request
    })
    .then(res => res.json())
    .then(() => {
        window.location.reload(); // Refresh UI after logout
    });
}

function toggleDropdown() {
    const menu = document.getElementById('dropdownMenu');
    menu.classList.toggle('show');
}

  