import { withShipNavLights } from './shipNavLights.js';

export const ATLAS_EDITOR_DEFAULTS = {
  "label": "Atlas",
  "frontAxis": "+X",
  "hardpoints": [
    {
      "id": "m_scw11nw",
      "type": "main",
      "x": -254.21,
      "y": -392.89
    },
    {
      "id": "m_3ppbqwl",
      "type": "main",
      "x": -254.21,
      "y": 392.89
    },
    {
      "id": "m_d7zc4sn",
      "type": "main",
      "x": -381.32,
      "y": -282.32
    },
    {
      "id": "m_12sf2ih",
      "type": "main",
      "x": -381.32,
      "y": 282.32
    },
    {
      "id": "m_45aljrw",
      "type": "main",
      "x": -1068.62,
      "y": -498.75
    },
    {
      "id": "m_u1izrwb",
      "type": "main",
      "x": -1068.62,
      "y": 498.75
    },
    {
      "id": "m_fbpli2w",
      "type": "main",
      "x": 541.38,
      "y": -301.13
    },
    {
      "id": "m_wnmhmte",
      "type": "main",
      "x": 541.38,
      "y": 301.13
    },
    {
      "id": "m_hbqth1t",
      "type": "main",
      "x": 983.9,
      "y": -183.51
    },
    {
      "id": "m_o2wd7xb",
      "type": "main",
      "x": 983.9,
      "y": 183.51
    },
    {
      "id": "m_g7dubln",
      "type": "main",
      "x": 1612.35,
      "y": -141.15
    },
    {
      "id": "m_faycpz4",
      "type": "main",
      "x": 1612.35,
      "y": 141.15
    },
    {
      "id": "m_34bj65q",
      "type": "main",
      "x": -1414.64,
      "y": -312.91
    },
    {
      "id": "m_ecn9awd",
      "type": "main",
      "x": -1414.64,
      "y": 312.91
    },
    {
      "id": "m_3gty7sy",
      "type": "main",
      "x": -1480.54,
      "y": -9.4
    },
    {
      "id": "m_0i0p2k0",
      "type": "special",
      "x": -799.36,
      "y": -349.55
    },
    {
      "id": "m_lm5ij9b",
      "type": "special",
      "x": -799.36,
      "y": 349.55
    },
    {
      "id": "m_m5ccyux",
      "type": "special",
      "x": -1099.12,
      "y": -299.61
    },
    {
      "id": "m_htg497z",
      "type": "special",
      "x": -1099.12,
      "y": 299.61
    },
    {
      "id": "m_3msvxvv",
      "type": "special",
      "x": -549.56,
      "y": -249.68
    },
    {
      "id": "m_m1mhsv7",
      "type": "special",
      "x": -549.56,
      "y": 249.68
    },
    {
      "id": "m_semqdz5",
      "type": "aux",
      "x": 1304,
      "y": -207.02
    },
    {
      "id": "m_qd8ttnl",
      "type": "aux",
      "x": 1304,
      "y": 207.02
    },
    {
      "id": "m_c8mzs7m",
      "type": "aux",
      "x": 1704.16,
      "y": -79.98
    },
    {
      "id": "m_puf65g2",
      "type": "aux",
      "x": 1704.16,
      "y": 79.98
    },
    {
      "id": "m_gk5ag7d",
      "type": "aux",
      "x": -1626.47,
      "y": -223.5
    },
    {
      "id": "m_zia82fy",
      "type": "aux",
      "x": -1626.47,
      "y": 223.5
    },
    {
      "id": "m_9o8ebs4",
      "type": "aux",
      "x": -927.4,
      "y": -576.4
    },
    {
      "id": "m_w0aiify",
      "type": "aux",
      "x": -927.4,
      "y": 576.4
    },
    {
      "id": "m_ztuc5hv",
      "type": "aux",
      "x": 313.06,
      "y": -322.31
    },
    {
      "id": "m_j34ed7j",
      "type": "aux",
      "x": 313.06,
      "y": 322.31
    },
    {
      "id": "m_8sadgwv",
      "type": "aux",
      "x": -616.69,
      "y": -574.05
    },
    {
      "id": "m_nmblzmt",
      "type": "aux",
      "x": -616.69,
      "y": 574.05
    },
    {
      "id": "m_4q22jvm",
      "type": "aux",
      "x": -127.11,
      "y": -407.02
    },
    {
      "id": "m_frcnqjx",
      "type": "aux",
      "x": -127.11,
      "y": 407.02
    },
    {
      "id": "m_zrm2gxm",
      "type": "hangar",
      "x": 506.07,
      "y": 390.54
    },
    {
      "id": "m_rs9o7t5",
      "type": "hangar",
      "x": 506.07,
      "y": -390.54
    },
    {
      "id": "m_dynrpvy",
      "type": "hangar",
      "x": 183.6,
      "y": 397.59
    },
    {
      "id": "m_umbnbzt",
      "type": "hangar",
      "x": 183.6,
      "y": -397.59
    },
    {
      "id": "m_hd2ctei",
      "type": "hangar",
      "x": -122.4,
      "y": 451.71
    },
    {
      "id": "m_t5ab9iv",
      "type": "hangar",
      "x": -122.4,
      "y": -451.71
    },
    {
      "id": "m_wx4ubuz",
      "type": "missile",
      "x": 456.63,
      "y": -2.35
    },
    {
      "id": "m_lbh11g4",
      "type": "missile",
      "x": -1070.98,
      "y": -7.05
    },
    {
      "id": "m_j34a3qw",
      "type": "special_missile",
      "x": -320.12,
      "y": -7.05
    },
    {
      "id": "m_rpo2vbp",
      "type": "builtin",
      "x": 814.41,
      "y": -2.35,
      "rot": 90
    }
  ],
  "cores": [],
  "engines": {
    "main": [
      {
        "id": "m_2oq4era",
        "x": -1501.74,
        "y": -400.46,
        "deg": 90,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "rear_left",
        "gimbalMinDeg": -45,
        "gimbalMaxDeg": 45,
        "vfxLengthMin": 10,
        "vfxLengthMax": 179
      },
      {
        "id": "m_bbiqwgo",
        "x": -1608.57,
        "y": -225.44,
        "deg": 90,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "rear_left",
        "gimbalMinDeg": -45,
        "gimbalMaxDeg": 45,
        "vfxLengthMin": 10,
        "vfxLengthMax": 179
      },
      {
        "id": "m_histhbk",
        "x": -1676.82,
        "y": -5.93,
        "deg": 90,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "rear_center",
        "gimbalMinDeg": -45,
        "gimbalMaxDeg": 45,
        "vfxLengthMin": 10,
        "vfxLengthMax": 179
      },
      {
        "id": "m_obckzgc",
        "x": -1498.76,
        "y": 403.44,
        "deg": 90,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "rear_right",
        "gimbalMinDeg": -45,
        "gimbalMaxDeg": 45,
        "vfxLengthMin": 10,
        "vfxLengthMax": 179
      },
      {
        "id": "m_1qqu2c5",
        "x": -1617.48,
        "y": 219.51,
        "deg": 90,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "rear_right",
        "gimbalMinDeg": -45,
        "gimbalMaxDeg": 45,
        "vfxLengthMin": 10,
        "vfxLengthMax": 179
      }
    ],
    "side": [
      {
        "id": "m_8q0i2dn",
        "x": -1507.67,
        "y": 450.9,
        "deg": 0,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "lower_right",
        "gimbalMinDeg": -90,
        "gimbalMaxDeg": 90,
        "vfxWidthMin": 25,
        "vfxWidthMax": 227,
        "vfxLengthMin": 49,
        "vfxLengthMax": 354
      },
      {
        "id": "m_850396e",
        "x": -1507.67,
        "y": -450.9,
        "deg": 180,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "lower_left",
        "gimbalMinDeg": -90,
        "gimbalMaxDeg": 90,
        "vfxWidthMin": 25,
        "vfxWidthMax": 227,
        "vfxLengthMin": 49,
        "vfxLengthMax": 354
      },
      {
        "id": "m_sn11h93",
        "x": -1374.11,
        "y": 453.85,
        "deg": 0,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "lower_right",
        "gimbalMinDeg": -90,
        "gimbalMaxDeg": 90,
        "vfxWidthMin": 25,
        "vfxWidthMax": 227,
        "vfxLengthMin": 49,
        "vfxLengthMax": 354
      },
      {
        "id": "m_271br9e",
        "x": -1374.11,
        "y": -453.85,
        "deg": 180,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "lower_left",
        "gimbalMinDeg": -90,
        "gimbalMaxDeg": 90,
        "vfxWidthMin": 25,
        "vfxWidthMax": 227,
        "vfxLengthMin": 49,
        "vfxLengthMax": 354
      },
      {
        "id": "m_o8sfkqm",
        "x": 1620.43,
        "y": 189.86,
        "deg": 0,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "upper_right",
        "gimbalMinDeg": -90,
        "gimbalMaxDeg": 90,
        "vfxWidthMin": 25,
        "vfxWidthMax": 227,
        "vfxLengthMin": 49,
        "vfxLengthMax": 354
      },
      {
        "id": "m_jom7l5q",
        "x": 1620.43,
        "y": -189.86,
        "deg": 180,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "upper_left",
        "gimbalMinDeg": -90,
        "gimbalMaxDeg": 90,
        "vfxWidthMin": 25,
        "vfxWidthMax": 227,
        "vfxLengthMin": 49,
        "vfxLengthMax": 354
      },
      {
        "id": "m_rzcpqhv",
        "x": 1513.6,
        "y": 207.65,
        "deg": 0,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "upper_right",
        "gimbalMinDeg": -90,
        "gimbalMaxDeg": 90,
        "vfxWidthMin": 25,
        "vfxWidthMax": 227,
        "vfxLengthMin": 49,
        "vfxLengthMax": 354
      },
      {
        "id": "m_vuz8czo",
        "x": 1513.6,
        "y": -207.65,
        "deg": 180,
        "offsetX": 0,
        "offsetY": 0,
        "mount": "upper_left",
        "gimbalMinDeg": -90,
        "gimbalMaxDeg": 90,
        "vfxWidthMin": 25,
        "vfxWidthMax": 227,
        "vfxLengthMin": 49,
        "vfxLengthMax": 354
      }
    ]
  },
  "lights": withShipNavLights('atlas', {
    "road": [
      { "id": "m_ic8ahjt", "x": 1748.35, "y": -59.42, "color": "#ffffff", "power": 3, "radius": 14, "deg": 90, "range": 800, "coneDeg": 40 },
      { "id": "m_5wddzqz", "x": 1748.35, "y": 59.42, "color": "#ffffff", "power": 3, "radius": 14, "deg": 90, "range": 800, "coneDeg": 40 }
    ]
  })
};
