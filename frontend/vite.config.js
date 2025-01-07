// frontend/vite.config.js
export default {
  server: {
    proxy: {
      '/api': 'http://localhost:3000', // Proxy to the backend server
    },
  },
};
