import { Injectable, signal, computed, OnDestroy, effect } from '@angular/core';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { getDatabase, ref, onValue, set, get } from 'firebase/database';

const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyArMDaPtSCgz20QUlJhnUhhq5cRT98G7RI',
  authDomain: 'miproyectoindicadores.firebaseapp.com',
  databaseURL: 'https://miproyectoindicadores-default-rtdb.firebaseio.com',
  projectId: 'miproyectoindicadores',
  storageBucket: 'miproyectoindicadores.firebasestorage.app',
  messagingSenderId: '572003613740',
  appId: '1:572003613740:web:4001cae49871f7f467589'
};

export interface SafetyData { daysWithoutAccident: number; recordDays: number; previousRecord: number; lti: number; mti: number; fac: number; }
export interface FreightData { day: string; planned: number; real: number; }
export interface CrewData { name: string; pdf: number; stayTime: string; plantTime: string; palletsAverage: number; security: number; totalSum: number; ranking: number; }
export interface WasteData { material: string; real: number; target: number; }
export interface WarehouseData { ptReal: number; ptCap: number; matReal: number; matCap: number; }
export interface DowntimeItem { line: string; lostTime: number; crew: string; pdf: number; }
export interface StayTimeData { day: string; real: number; goal: number; }
export interface BonusData { description: string; min: number; sat: number; exc: number; accumulated: number; weight: string; format: 'currency' | 'percent' | 'time' | 'number'; status: string; }
export type WidgetId = 'safety' | 'freight' | 'downtime' | 'stayTime' | 'waste_discipline' | 'bonus' | 'crew';
export interface WidgetConfig { id: WidgetId; label: string; }
export type PerformanceMode = 'high' | 'eco';

interface GlobalState {
  safety: SafetyData; warehouse: WarehouseData; freight: FreightData[]; stayTime: StayTimeData[];
  crews: CrewData[]; waste: WasteData[]; downtime: DowntimeItem[]; bonusObjectives: BonusData[];
  layout: WidgetConfig[]; announcement: string; isSimulationActive: boolean; performanceMode: PerformanceMode; lastUpdate: string;
}

@Injectable({ providedIn: 'root' })
export class StoreService implements OnDestroy {
  readonly safety = signal<SafetyData>({ daysWithoutAccident: 87, recordDays: 289, previousRecord: 467, lti: 0, mti: 0, fac: 0 });
  readonly warehouse = signal<WarehouseData>({ ptReal: 18500, ptCap: 22000, matReal: 4200, matCap: 5000 });
  readonly freight = signal<FreightData[]>([]);
  readonly stayTime = signal<StayTimeData[]>([]);
  readonly crews = signal<CrewData[]>([]);
  readonly waste = signal<WasteData[]>([]);
  readonly downtime = signal<DowntimeItem[]>([]);
  readonly bonusObjectives = signal<BonusData[]>([]);
  readonly layout = signal<WidgetConfig[]>([
    { id: 'safety', label: 'Seguridad y Almacén' }, { id: 'freight', label: 'Fleteo' },
    { id: 'downtime', label: 'Tiempo Perdido (Montacargas)' }, { id: 'stayTime', label: 'Tiempo de Estancia' },
    { id: 'waste_discipline', label: 'Merma y Disciplina' }, { id: 'bonus', label: 'Objetivos Bono Planta' },
    { id: 'crew', label: 'Resultados Tripulación' },
  ]);
  readonly announcement = signal<string>('⚠️ AVISO: Auditoría de Seguridad programada para el próximo Jueves. Mantener áreas despejadas. ⚠️');
  readonly lastUpdate = signal<Date>(new Date());
  readonly isSimulationActive = signal<boolean>(false);
  readonly performanceMode = signal<PerformanceMode>('high');
  readonly syncStatus = signal<'cloud' | 'local'>('local');
  readonly authUser = signal<User | null>(null);
  readonly authError = signal<string | null>(null);
  readonly authReady = signal<boolean>(false);

  private simulationInterval: any;
  private fastSimulationInterval: any;
  private readonly STORAGE_KEY = 'dashboard_db_state_v4_orsted';
  private isRemoteUpdate = false;
  private db: any;
  private auth: any;
  private isFirebaseConfigured = false;

  readonly bonusGlobal = computed(() => {
    const objs = this.bonusObjectives();
    let totalScore = 0, totalWeight = 0;
    objs.forEach(obj => {
      const w = parseFloat(obj.weight.replace('%', ''));
      if (!isNaN(w)) {
        totalWeight += w;
        if (obj.status === 'Excelente') totalScore += w;
        else if (obj.status === 'Satisfactorio') totalScore += w * 0.85;
        else if (obj.status === 'Minimo') totalScore += w * 0.70;
      }
    });
    const percentage = totalWeight > 0 ? (totalScore / totalWeight) * 100 : 0;
    let label = 'Bajo';
    if (percentage >= 95) label = 'Alto';
    else if (percentage >= 80) label = 'Medio';
    return { percentage: Math.min(100, Math.round(percentage)), label };
  });

  readonly bestCrew = computed(() =>
    this.crews().find(c => c.ranking === 1) || (this.crews().length > 0 ? this.crews()[0] : { name: '-', totalSum: 0 } as CrewData)
  );

  constructor() {
    this.detectHardware();
    this.initDefaultData();
    this.initPersistenceAndSync();
    if (this.isSimulationActive()) this.startSimulation();
  }

  ngOnDestroy() { this.stopSimulation(); }

  async login(email: string, password: string): Promise<boolean> {
    this.authError.set(null);
    try {
      if (!this.auth) { this.authError.set('Autenticacion no inicializada'); return false; }
      await signInWithEmailAndPassword(this.auth, email, password);
      return true;
    } catch (e: any) {
      this.authError.set(e?.message || 'Error de autenticacion');
      return false;
    }
  }

  async logout(): Promise<void> {
    this.authError.set(null);
    if (this.auth) await signOut(this.auth);
  }

  private detectHardware() {
    if (typeof navigator === 'undefined') return;
    const ua = navigator.userAgent.toLowerCase();
    const isTV = /smart-tv|webos|tizen|bravia|roku|vizio|hisense|tcl/.test(ua) || ((ua.includes('samsung') || ua.includes('lg')) && ua.includes('tv'));
    const lowConcurrency = (navigator.hardwareConcurrency || 4) < 4;
    const lowMemory = (navigator as any).deviceMemory && (navigator as any).deviceMemory < 2;
    this.performanceMode.set((isTV || lowConcurrency || lowMemory) ? 'eco' : 'high');
  }

  togglePerformanceMode() { this.performanceMode.update(m => m === 'high' ? 'eco' : 'high'); }

  forceSync() {
    if (this.isFirebaseConfigured && this.db) {
      get(ref(this.db, 'dashboard_state')).then(snapshot => {
        const val = snapshot.val();
        if (val) {
          this.isRemoteUpdate = true;
          const { isSimulationActive: _sim, performanceMode: _perf, ...remote } = val;
          this.applyState(remote);
          this.isRemoteUpdate = false;
        }
      }).catch(err => console.error('Force sync failed', err));
    }
  }

  private initPersistenceAndSync() {
    if (FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey !== 'API_KEY_PLACEHOLDER') {
      try {
        const app = initializeApp(FIREBASE_CONFIG);
        this.db = getDatabase(app);
        this.auth = getAuth(app);
        this.isFirebaseConfigured = true;
        this.syncStatus.set('cloud');
        onAuthStateChanged(this.auth, (user) => { this.authUser.set(user); this.authReady.set(true); });
        onValue(ref(this.db, 'dashboard_state'), (snapshot) => {
          const val = snapshot.val();
          if (val) {
            this.isRemoteUpdate = true;
            const { isSimulationActive: _sim, performanceMode: _perf, ...remote } = val;
            this.applyState(remote);
            this.isRemoteUpdate = false;
          }
        });
      } catch (e) {
        console.error('Sync: Firebase init failed', e);
        this.syncStatus.set('local');
        this.authReady.set(true);
      }
    } else {
      this.syncStatus.set('local');
      this.authReady.set(true);
    }

    const storedState = localStorage.getItem(this.STORAGE_KEY);
    if (storedState) {
      try {
        const parsed: GlobalState = JSON.parse(storedState);
        this.applyState(parsed);
        if (parsed.performanceMode) this.performanceMode.set(parsed.performanceMode);
        if (parsed.isSimulationActive !== undefined && this.isSimulationActive() !== parsed.isSimulationActive) {
          this.isSimulationActive.set(parsed.isSimulationActive);
          if (parsed.isSimulationActive) this.startSimulation(); else this.stopSimulation();
        }
      } catch (e) {
        console.error('Database: Failed to parse stored state', e);
      }
    }

    effect(() => {
      const state: GlobalState = {
        safety: this.safety(), warehouse: this.warehouse(), freight: this.freight(), stayTime: this.stayTime(),
        crews: this.crews(), waste: this.waste(), downtime: this.downtime(), bonusObjectives: this.bonusObjectives(),
        layout: this.layout(), announcement: this.announcement(), isSimulationActive: this.isSimulationActive(),
        performanceMode: this.performanceMode(), lastUpdate: this.lastUpdate().toISOString()
      };
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(state));
      const user = this.authUser();
      if (!this.isRemoteUpdate && this.isFirebaseConfigured && this.db && user) {
        const { isSimulationActive, performanceMode, ...remoteState } = state;
        set(ref(this.db, 'dashboard_state'), remoteState).catch(err => console.error('Sync: Push failed', err));
      }
    });
  }

  private applyState(state: GlobalState) {
    if (!state) return;
    if (state.safety) this.safety.set(state.safety);
    if (state.warehouse) this.warehouse.set(state.warehouse);
    if (state.freight) this.freight.set(state.freight);
    if (state.stayTime) this.stayTime.set(state.stayTime);
    if (state.crews) this.crews.set(state.crews);
    if (state.waste) this.waste.set(state.waste);
    if (state.downtime) this.downtime.set(state.downtime);
    if (state.bonusObjectives) {
      this.bonusObjectives.set(state.bonusObjectives.map(item => ({ ...item, status: this.calculateBonusStatus(item) })));
    }
    if (state.layout) this.layout.set(state.layout);
    if (state.announcement) this.announcement.set(state.announcement);
    if (state.lastUpdate) this.lastUpdate.set(new Date(state.lastUpdate));
    // isSimulationActive / performanceMode are local-only
  }

  private initDefaultData() {
    this.crews.set([
      { name: 'ARMAGEDOM', pdf: 1.12, stayTime: '00:50', plantTime: '00:46', palletsAverage: 14433, security: 5.00, totalSum: 18, ranking: 1 },
      { name: 'CRACKS', pdf: 1.03, stayTime: '00:58', plantTime: '00:53', palletsAverage: 15606, security: 5.00, totalSum: 16, ranking: 2 },
    ]);
    const rawBonus: BonusData[] = [
      { description: 'Merma producto terminado', min: 319633, sat: 312974, exc: 306315, accumulated: 300000, weight: '20%', format: 'currency', status: '' },
      { description: 'Cumplimiento programas Fleteo', min: 97, sat: 98, exc: 99, accumulated: 98.5, weight: '30%', format: 'percent', status: '' },
    ];
    this.bonusObjectives.set(rawBonus.map(item => ({ ...item, status: this.calculateBonusStatus(item) })));
    this.freight.set(Array.from({ length: 10 }, (_, i) => ({ day: 'Dia ' + (i + 1), planned: 3000, real: 2800 + i * 10 })));
    this.stayTime.set(Array.from({ length: 10 }, (_, i) => ({ day: 'D' + (i + 1), real: 50 + i, goal: 55 })));
    this.waste.set([{ material: 'Pet', real: 1250.50, target: 800.00 }]);
    this.downtime.set([{ line: 'LINEA001', lostTime: 115, crew: 'ARMAGEDOM', pdf: 1.12 }]);
  }

  updateSafety(data: Partial<SafetyData>) { this.safety.update(s => ({ ...s, ...data })); this.touchUpdate(); }
  updateWarehouse(data: Partial<WarehouseData>) { this.warehouse.update(w => ({ ...w, ...data })); this.touchUpdate(); }
  updateFreight(data: FreightData[]) { this.freight.set(data); this.touchUpdate(); }
  updateStayTime(data: StayTimeData[]) { this.stayTime.set(data); this.touchUpdate(); }
  updateWaste(data: WasteData[]) { this.waste.set(data); this.touchUpdate(); }
  updateDowntime(data: DowntimeItem[]) { this.downtime.set(data); this.touchUpdate(); }
  updateAnnouncement(text: string) { this.announcement.set(text); this.touchUpdate(); }
  updateCrew(index: number, data: Partial<CrewData>) {
    this.crews.update(crews => { const n = [...crews]; n[index] = { ...n[index], ...data }; return n; });
    this.touchUpdate();
  }

  private calculateBonusStatus(item: BonusData): string {
    const val = item.accumulated;
    const lowerIsBetter = item.exc < item.min;
    if (lowerIsBetter) {
      if (val <= item.exc) return 'Excelente';
      if (val <= item.sat) return 'Satisfactorio';
      if (val <= item.min) return 'Minimo';
      return 'Bajo';
    }
    if (val >= item.exc) return 'Excelente';
    if (val >= item.sat) return 'Satisfactorio';
    if (val >= item.min) return 'Minimo';
    return 'Bajo';
  }

  updateBonusResult(description: string, newValue: number) {
    this.bonusObjectives.update(items => items.map(item => {
      if (item.description.toLowerCase().includes(description.toLowerCase()) || description.toLowerCase().includes(item.description.toLowerCase())) {
        const updated = { ...item, accumulated: newValue };
        updated.status = this.calculateBonusStatus(updated);
        return updated;
      }
      return item;
    }));
    this.touchUpdate();
  }

  updateBonusRaw(index: number, data: Partial<BonusData>) {
    this.bonusObjectives.update(items => {
      const n = [...items];
      const updated = { ...n[index], ...data };
      updated.status = this.calculateBonusStatus(updated);
      n[index] = updated;
      return n;
    });
    this.touchUpdate();
  }

  moveWidget(index: number, direction: 'up' | 'down') {
    this.layout.update(current => {
      const n = [...current];
      const t = direction === 'up' ? index - 1 : index + 1;
      if (t >= 0 && t < n.length) [n[index], n[t]] = [n[t], n[index]];
      return n;
    });
  }

  toggleSimulation(active: boolean) {
    this.isSimulationActive.set(active);
    if (active) this.startSimulation(); else this.stopSimulation();
  }

  randomizeFreight() {
    this.freight.update(current => current.map(item => {
      const chance = Math.random();
      let adjustment = chance > 0.3 ? (Math.floor(Math.random() * 25) + 5) : (Math.floor(Math.random() * 10) - 5);
      let newReal = Math.max(0, item.real + adjustment);
      if (newReal > (item.planned * 1.1)) newReal = item.planned * 0.85;
      return { ...item, real: newReal };
    }));
    this.touchUpdate();
  }

  randomizeStayTime() {
    this.stayTime.update(current => current.map(item => ({
      ...item, real: Math.max(20, Math.min(120, item.real + Math.floor((Math.random() - 0.5) * 10)))
    })));
    this.touchUpdate();
  }

  randomizeSafetyAndWarehouse() {
    this.safety.update(s => {
      let newLti = s.lti, newMti = s.mti;
      if (Math.random() > 0.9) {
        if (Math.random() > 0.5) newLti = Math.max(0, s.lti + (Math.random() > 0.5 ? 1 : -1));
        if (Math.random() > 0.5) newMti = Math.max(0, s.mti + (Math.random() > 0.5 ? 1 : -1));
      }
      return { ...s, lti: newLti, mti: newMti };
    });
    this.warehouse.update(w => ({
      ...w,
      ptReal: Math.max(0, Math.min(w.ptCap, w.ptReal + Math.floor((Math.random() - 0.5) * 500))),
      matReal: Math.max(0, Math.min(w.matCap, w.matReal + Math.floor((Math.random() - 0.5) * 200)))
    }));
    this.touchUpdate();
  }

  private startSimulation() {
    this.stopSimulation();
    this.simulationInterval = setInterval(() => { this.randomizeFreight(); this.randomizeStayTime(); }, 30000);
    this.fastSimulationInterval = setInterval(() => { this.randomizeSafetyAndWarehouse(); }, 15000);
  }

  private stopSimulation() {
    if (this.simulationInterval) clearInterval(this.simulationInterval);
    if (this.fastSimulationInterval) clearInterval(this.fastSimulationInterval);
  }

  private touchUpdate() { this.lastUpdate.set(new Date()); }
}
