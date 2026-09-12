/**
 * 中文化元器件库与柜体布局常量。
 * 保留原项目 lib_key、型号、尺寸、分区及算法逻辑，仅修改面向用户的显示文字。
 */
import type { Library, LayoutDefaults } from "./types";

/** DIN 模数宽度单位。 */
export const DIN_MODULE_MM = 18;

/** 标准线槽截面尺寸。 */
export const STANDARD_DUCT_SIZES: ReadonlyArray<{ w: number; h: number }> = [
  { w: 30, h: 30 },
  { w: 30, h: 40 },
  { w: 40, h: 60 },
  { w: 60, h: 60 },
];

export const DEFAULT_DUCT_LENGTH_MM = 300;

export const DEFAULTS: LayoutDefaults = {
  gap_between_equipment_mm: 0.1,
  clearance_equipment_to_duct_mm: 3,
};

/** 柜体模板。 */
export const ENCLOSURE_TEMPLATES = {
  tall_floor: {
    label: "高型落地柜（约2000×800）",
    plate: { width_mm: 800, height_mm: 1500 },
    side_duct: { width_mm: 60, label_h_mm: 60 },
    row_duct: { width_mm: 40, label_h_mm: 60 },
  },
  wide_box: {
    label: "宽型通风控制箱（约1200×800）",
    plate: { width_mm: 800, height_mm: 700 },
    side_duct: { width_mm: 40, label_h_mm: 60 },
    row_duct: { width_mm: 40, label_h_mm: 60 },
  },
} as const;

/** 功能分区，从上到下排列。 */
export const BANDS = [
  { band: 1, name: "电源与保护" },
  { band: 2, name: "控制与通讯（PLC、I/O、路由器）" },
  { band: 3, name: "继电器" },
  { band: 4, name: "接线端子" },
  { band: 5, name: "接地排" },
  { band: 6, name: "端子挡块" },
  { band: 7, name: "窄型端子挡块" },
  { band: 8, name: "附件" },
] as const;

/** 作为挡块处理的分类。 */
export const STOPPER_BANDS: ReadonlySet<number> = new Set([6, 7]);

const _nameColl = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
/** 按显示名称进行自然排序。 */
export function byName(a: { name: string }, b: { name: string }): number {
  return _nameColl.compare(a.name || "", b.name || "");
}

/**
 * 默认元器件库。
 * confirm:true 表示尺寸仍需根据实物、图纸或数据手册确认。
 */
export const SEED_LIBRARY: Library = {
  // --- 分区2：控制与通讯 ---
  plc_idec_FC6A_R16CE: {
    lib_key: "plc_idec_FC6A_R16CE", source: "rect", name: "PLC IDEC FC6A-R16CE",
    band: 2, width_mm: 95, height_mm: 90, confirm: true,
  },
  plc_idec_FC6A_D16: {
    lib_key: "plc_idec_FC6A_D16", source: "rect", name: "PLC IDEC FC6A-D16R1CEE",
    band: 2, width_mm: 70.19, height_mm: 103.29, confirm: false,
  },
  io_idec_FC6A_J8A1: {
    lib_key: "io_idec_FC6A_J8A1", source: "rect", name: "模拟量输入模块 IDEC FC6A-J8A1",
    band: 2, width_mm: 30, height_mm: 90, confirm: true,
  },
  io_idec_FC6A_N32B3: {
    lib_key: "io_idec_FC6A_N32B3", source: "rect", name: "数字量输入模块 IDEC FC6A-N32B3",
    band: 2, width_mm: 30, height_mm: 90, confirm: true,
  },
  io_idec_FC6A_M24BR1: {
    lib_key: "io_idec_FC6A_M24BR1", source: "rect", name: "数字量输入/输出模块 IDEC FC6A-M24BR1",
    band: 2, width_mm: 30, height_mm: 90, confirm: true,
  },
  modem_robustel_R1520_R4: {
    lib_key: "modem_robustel_R1520_R4", source: "rect", name: "工业路由器 Robustel R1520-R4",
    band: 2, width_mm: 45, height_mm: 90, confirm: true,
  },
  poe_switch: {
    lib_key: "poe_switch", source: "rect", name: "PoE交换机",
    band: 2, width_mm: 60, height_mm: 90, confirm: true,
  },

  // --- 分区1：电源与保护 ---
  psu_switching_24vdc: {
    lib_key: "psu_switching_24vdc", source: "rect", name: "24VDC开关电源",
    band: 1, width_mm: 40, height_mm: 110, confirm: true,
  },
  mcp_2p: {
    lib_key: "mcp_2p", source: "rect", name: "2P电动机保护断路器 MCP",
    band: 1, width_mm: 36, height_mm: 85, confirm: false,
  },
  mcb_3p: {
    lib_key: "mcb_3p", source: "rect", name: "3P微型断路器 MCB",
    band: 1, width_mm: 54, height_mm: 85, confirm: false,
  },
  breaker_aux_S01: {
    lib_key: "breaker_aux_S01", source: "rect", name: "S01辅助断路器",
    band: 1, width_mm: 36, height_mm: 85, confirm: false,
  },
  spd: {
    lib_key: "spd", source: "rect", name: "浪涌保护器 SPD",
    band: 1, width_mm: 36, height_mm: 85, confirm: true,
  },
  surge_arrester: {
    lib_key: "surge_arrester", source: "rect", name: "避雷器",
    band: 1, width_mm: 18, height_mm: 85, confirm: true,
  },
  fuse_holder: {
    lib_key: "fuse_holder", source: "rect", name: "熔断器座",
    band: 1, width_mm: 18, height_mm: 70, confirm: true,
  },
  thermostat_no: {
    lib_key: "thermostat_no", source: "rect", name: "常开温控器（TS01）",
    band: 1, width_mm: 45, height_mm: 50, confirm: true,
  },

  // --- 分区3：继电器 ---
  relay_220vac_2c: {
    lib_key: "relay_220vac_2c", source: "rect", name: "220VAC 两组转换触点继电器",
    band: 3, width_mm: 15.5, height_mm: 80, confirm: true,
  },
  relay_24vdc_2c: {
    lib_key: "relay_24vdc_2c", source: "rect", name: "24VDC 两组转换触点继电器",
    band: 3, width_mm: 15.5, height_mm: 80, confirm: true,
  },

  // --- 分区4：接线端子 ---
  term_degson_2c_2_5: {
    lib_key: "term_degson_2c_2_5", source: "rect", name: "DEGSON高松 2.5mm² 双层端子（2C）",
    band: 4, width_mm: 5.2, height_mm: 50, confirm: true,
  },
  term_degson_4c_2_5: {
    lib_key: "term_degson_4c_2_5", source: "rect", name: "DEGSON高松 2.5mm² 四层端子（4C）",
    band: 4, width_mm: 5.2, height_mm: 50, confirm: true,
  },
  term_block_40pin: {
    lib_key: "term_block_40pin", source: "rect", name: "40位接线端子排",
    band: 4, width_mm: 60, height_mm: 40, confirm: true,
  },
  term_stopper: {
    lib_key: "term_stopper", source: "rect", name: "DIN导轨端子挡块",
    band: 4, width_mm: 9.5, height_mm: 43.2, confirm: false,
  },
  term_stopper_label: {
    lib_key: "term_stopper_label", source: "rect", name: "端子挡块标记牌",
    width_mm: 9.5, height_mm: 43.2, confirm: false, label_plate: true,
  },

  // --- 分区5：电源分配 ---
  term_fuse_holder: {
    lib_key: "term_fuse_holder", source: "rect", name: "端子式熔断器座",
    band: 5, width_mm: 8, height_mm: 50, confirm: true,
  },

  // --- 分区6：接地 ---
  ground_bar_6: {
    lib_key: "ground_bar_6", source: "rect", name: "6位接地铜排",
    band: 6, width_mm: 120, height_mm: 15, confirm: true,
  },
};

/** 仅用于 BOM 的附件。 */
export const BOM_ONLY_ACCESSORIES = [
  "DEGSON高松端子末端盖板",
  "DEGSON高松2C端子末端隔板",
  "DEGSON高松4C端子末端隔板",
  "DEGSON高松端子挡块标记牌",
] as const;
