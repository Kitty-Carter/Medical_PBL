// 临床数值校验器（防止伪值成为锚点）
const clinicalValueValidator = {
  isPlausible(key, value) {
    const num = parseFloat(value);
    if (isNaN(num)) return false;

    const ranges = {
      BP: [40, 250],      // 收缩压范围（粗略）
      HR: [20, 250],
      RR: [5, 60],
      SpO2: [50, 100],
      T: [30, 45],
      Hb: [20, 250],
      PLT: [0, 1000],
      PT: [5, 100],
      APTT: [10, 150],
      FIB: [0, 10],
      'D-dimer': [0, 100],
      Lactate: [0, 30],
      '尿量': [0, 5000],
      '出血量': [0, 10000],
    };

    const range = ranges[key];
    if (!range) return true;
    return num >= range[0] && num <= range[1];
  },
};

module.exports = { clinicalValueValidator };
