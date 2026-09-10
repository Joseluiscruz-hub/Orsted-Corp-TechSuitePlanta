import { Component, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DashboardComponent } from './components/dashboard/dashboard.component';
import { AdminComponent } from './components/admin/admin.component';
import { StoreService } from './services/store.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, DashboardComponent, AdminComponent],
  templateUrl: './app.component.html',
})
export class AppComponent {
  store = inject(StoreService);
  currentView = signal<'dashboard' | 'admin'>('dashboard');
  showLogin = signal(false);
  loginEmail = '';
  loginPassword = '';

  openAdmin() {
    if (this.store.authUser()) {
      this.showLogin.set(false);
      this.currentView.set('admin');
    } else {
      this.showLogin.set(true);
    }
  }

  goDashboard() {
    this.currentView.set('dashboard');
    this.showLogin.set(false);
  }

  async submitLogin() {
    const ok = await this.store.login(this.loginEmail, this.loginPassword);
    if (ok) {
      this.showLogin.set(false);
      this.loginPassword = '';
      this.currentView.set('admin');
    }
  }

  async logout() {
    await this.store.logout();
    this.currentView.set('dashboard');
    this.showLogin.set(false);
  }
}
