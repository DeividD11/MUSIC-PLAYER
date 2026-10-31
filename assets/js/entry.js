const hasSession = Boolean(sessionStorage.getItem('mp_session'));
window.location.replace(hasSession ? './dashboard.html' : './login.html');
