export default function watchMainMenu() {
  const button = document.querySelector('.js-menu-toggle');
  const menu = document.querySelector('.js-menu-area');

  if (button && menu) {
    button.addEventListener('click', () => {
      button.classList.toggle('is-active');
      menu.classList.toggle('is-active');
    });
  }
}
