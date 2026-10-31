import { AppController } from './controllers/app.controller.js';

const app = new AppController();
app.init().catch((error) => {
  console.error('MUSIC PLAYER initialization failed:', error);
  document.body.dataset.appError = 'true';
});
