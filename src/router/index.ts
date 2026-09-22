import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

import { useAuthStore } from '../stores/auth'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'library',
    component: () => import('../views/LibraryView.vue')
  },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue')
  },
  {
    path: '/read/:id',
    name: 'reader',
    component: () => import('../views/ReaderView.vue'),
    props: true
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('../views/SettingsView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

router.beforeEach((to) => {
  const auth = useAuthStore()
  const isLogin = to.name === 'login'

  if (!auth.isAuthenticated) {
    if (isLogin) {
      return true
    }
    // OAuth callback: hand the code to LoginView instead of bouncing it away.
    if (typeof to.query.code === 'string' && to.query.code) {
      return { name: 'login', query: to.query }
    }
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  if (isLogin) {
    return typeof to.query.redirect === 'string' && to.query.redirect
      ? to.query.redirect
      : '/'
  }

  return true
})

export default router