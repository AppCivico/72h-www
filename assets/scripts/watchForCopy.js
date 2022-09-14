const warningElement = document.getElementById('copy-warning');

function friendlyWarn() {
  if (warningElement.hasAttribute('hidden')) {
    warningElement.removeAttribute('hidden');
  }
}

function detectScreenCapture(e) {
  if (e.key === 'PrintScreen' || e.keyCode === 44) {
    friendlyWarn();
  } else if (e.shiftKey && e.ctrlKey) {
    switch (true) {
      // detect macOs CMD+SHIFT+3
      case e.key === '3':
      case e.keyCode === 51:
        friendlyWarn();
        break;

      // detect macOs CMD+SHIFT+4
      case e.key === '4':
      case e.keyCode === 52:
        friendlyWarn();
        break;

      default:
        break;
    }
  }
}

export default () => {
  document.addEventListener('copy', friendlyWarn);
  window.addEventListener('keyup', detectScreenCapture);
  window.setTimeout(friendlyWarn, 3 * 60 * 1000);
};
