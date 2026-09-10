import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StoreService } from '../../services/store.service';

declare const XLSX: any;

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin.component.html',
})
export class AdminComponent {
  store = inject(StoreService);
  safetyForm = { ...this.store.safety() };
  warehouseForm = { ...this.store.warehouse() };
  crews = this.store.crews;
  bonus = this.store.bonusObjectives;
  isAnalyzing = signal(false);
  analysisResult = signal<string | null>(null);
  isUploading = signal(false);

  saveSafety() { this.store.updateSafety(this.safetyForm); alert('Seguridad actualizada!'); }
  saveWarehouse() { this.store.updateWarehouse(this.warehouseForm); alert('Almacén actualizado!'); }
  updateAnnouncement(event: any) { this.store.updateAnnouncement(event.target.value); }

  updateCrewField(index: number, field: string, value: any) {
    let parsedValue = value;
    if (['pdf', 'palletsAverage', 'security', 'totalSum', 'ranking'].includes(field)) {
      const num = parseFloat(value);
      if (!isNaN(num)) parsedValue = num;
    }
    this.store.updateCrew(index, { [field]: parsedValue });
  }

  updateBonusField(index: number, field: string, value: any) {
    let parsedValue = value;
    if (['accumulated'].includes(field)) {
      const num = parseFloat(value);
      if (!isNaN(num)) parsedValue = num;
    }
    this.store.updateBonusRaw(index, { [field]: parsedValue });
  }

  randomizeFreight() { this.store.randomizeFreight(); }
  randomizeStayTime() { this.store.randomizeStayTime(); }
  moveWidget(index: number, direction: 'up' | 'down') { this.store.moveWidget(index, direction); }
  toggleSimulation() { this.store.toggleSimulation(!this.store.isSimulationActive()); }

  async generateCrewReport() {
    if (this.isAnalyzing()) return;
    this.isAnalyzing.set(true);
    this.analysisResult.set(null);
    this.analysisResult.set('Gemini ya no esta disponible en el cliente. La generacion de reportes con IA se movio al backend o esta deshabilitada por seguridad. Usa la carga Excel para actualizar indicadores.');
    this.isAnalyzing.set(false);
  }

  private parseExcelTime(val: any): number {
    if (val === undefined || val === null || val === '') return 0;
    if (val instanceof Date) return Math.round((val.getHours() * 60) + val.getMinutes());
    if (typeof val === 'string' && val.includes(':')) {
      const parts = val.split(':').map((p: string) => parseFloat(p));
      if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) return (parts[0] * 60) + parts[1];
    }
    const num = Number(val);
    if (!isNaN(num)) {
      if (num < 2.0 && num > 0) return Math.round(num * 24 * 60);
      return Math.round(num);
    }
    return 0;
  }

  private formatTimeToString(val: any): string {
    const minutes = this.parseExcelTime(val);
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  downloadTemplate() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([this.store.safety()]), 'Seguridad');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([this.store.warehouse()]), 'Almacen');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(this.store.freight()), 'Fleteo');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(this.store.stayTime()), 'TiempoEstancia');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(this.store.crews()), 'Tripulacion');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(this.store.waste()), 'Mermas');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(this.store.downtime()), 'TiempoPerdido');
    const bonusData = this.store.bonusObjectives().map(b => ({
      Indicador: b.description, MIN: b.min, SAT: b.sat, EXC: b.exc, Resultado: b.accumulated, Peso: b.weight
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bonusData), 'Bono');
    XLSX.writeFile(wb, 'Dashboard_Plantilla.xlsx');
  }

  async onFileChange(evt: any) {
    const target: DataTransfer = <DataTransfer>(evt.target);
    if (target.files.length !== 1) {
      alert('Por favor carga un solo archivo.');
      return;
    }
    const file = target.files[0];
    const lower = (file.name || '').toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
      alert('Solo se permiten archivos Excel (.xlsx / .xls).');
      evt.target.value = '';
      return;
    }
    this.isUploading.set(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      this.store.toggleSimulation(false);
      const workbook = XLSX.read(arrayBuffer, { dense: false });
      let updatedCount = 0;
      if (workbook.Sheets['Seguridad']) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['Seguridad']);
        if (data.length > 0) { this.store.updateSafety(data[0] as any); this.safetyForm = { ...this.store.safety() }; updatedCount++; }
      }
      if (workbook.Sheets['Almacen']) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['Almacen']);
        if (data.length > 0) { this.store.updateWarehouse(data[0] as any); this.warehouseForm = { ...this.store.warehouse() }; updatedCount++; }
      }
      if (workbook.Sheets['Fleteo']) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['Fleteo']);
        if (data.length > 0) { this.store.updateFreight(data as any); updatedCount++; }
      }
      if (workbook.Sheets['TiempoEstancia']) {
        const rawData = XLSX.utils.sheet_to_json(workbook.Sheets['TiempoEstancia']);
        if (rawData.length > 0) {
          this.store.updateStayTime(rawData.map((row: any) => ({
            day: row.day || row.Dia || row.Day,
            real: this.parseExcelTime(row.real),
            goal: this.parseExcelTime(row.goal || row.meta)
          })));
          updatedCount++;
        }
      }
      if (workbook.Sheets['Tripulacion']) {
        const rawData = XLSX.utils.sheet_to_json(workbook.Sheets['Tripulacion']);
        if (rawData.length > 0) {
          this.store.crews.set(rawData.map((row: any) => ({
            ...row,
            stayTime: this.formatTimeToString(row.stayTime),
            plantTime: this.formatTimeToString(row.plantTime)
          })));
          updatedCount++;
        }
      }
      if (workbook.Sheets['Mermas']) {
        const data = XLSX.utils.sheet_to_json(workbook.Sheets['Mermas']);
        if (data.length > 0) { this.store.updateWaste(data as any); updatedCount++; }
      }
      if (workbook.Sheets['TiempoPerdido']) {
        const rawData = XLSX.utils.sheet_to_json(workbook.Sheets['TiempoPerdido']);
        if (rawData.length > 0) {
          this.store.updateDowntime(rawData.map((row: any) => ({ ...row, lostTime: this.parseExcelTime(row.lostTime) })));
          updatedCount++;
        }
      }
      const bonusSheetName = workbook.SheetNames.find((n: string) => n.toLowerCase().includes('bono') || n.toLowerCase().includes('indicador'));
      if (bonusSheetName) {
        const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[bonusSheetName]);
        if (rawData.length > 0) {
          const currentObjectives = this.store.bonusObjectives();
          rawData.forEach((row: any) => {
            const desc = row.Indicador || row.Description || row.Descripcion;
            const result = row.Resultado || row.Accumulated || row.Real || row.accumulated;
            if (desc && result !== undefined) {
              const targetItem = currentObjectives.find(b =>
                b.description.toLowerCase().trim() === desc.toString().toLowerCase().trim() ||
                desc.toString().toLowerCase().includes(b.description.toLowerCase())
              );
              if (targetItem) {
                let finalResult = Number(result);
                if (targetItem.format === 'time') finalResult = this.parseExcelTime(result);
                else if (targetItem.format === 'percent' && finalResult <= 1 && finalResult > 0) finalResult = finalResult * 100;
                this.store.updateBonusResult(targetItem.description, finalResult);
              }
            }
          });
          updatedCount++;
        }
      }
      this.isUploading.set(false);
      if (updatedCount > 0) alert(`¡Éxito! Se actualizaron ${updatedCount} secciones.`);
      else alert('No se encontraron datos válidos.');
    } catch (err) {
      console.error(err);
      this.isUploading.set(false);
      alert('Error al leer el archivo. Verifica el formato.');
    }
    evt.target.value = '';
  }
}
