// Theme toggle logic
document.addEventListener('DOMContentLoaded', function () {
    const themeToggle = document.getElementById('themeToggle');
    const themeIcon = document.getElementById('themeIcon');
    const html = document.documentElement;

    function setTheme(theme) {
        html.setAttribute('data-bs-theme', theme);
        if (theme === 'dark') {
            themeIcon.className = 'bi bi-moon';
            themeToggle.classList.remove('btn-outline-dark');
            themeToggle.classList.add('btn-outline-light');
        } else {
            themeIcon.className = 'bi bi-sun';
            themeToggle.classList.remove('btn-outline-light');
            themeToggle.classList.add('btn-outline-dark');
        }
    }

    if (localStorage.getItem('theme')) {
        setTheme(localStorage.getItem('theme'));
    }

    themeToggle.addEventListener('click', () => {
        const current = html.getAttribute('data-bs-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        setTheme(next);
        localStorage.setItem('theme', next);
    });
});
