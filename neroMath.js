import { create, all } from 'mathjs';
import { deflateSync } from 'node:zlib';

const math = create(all, {
  number: 'number',
  precision: 64
});

const UNSAFE = /\b(?:import|createunit|reviver|evaluate|parse|compile|clear|help|delete)\b/i;
const SAFE_CHARS = /^[0-9A-Za-z_+\-*/%^().,\[\];<>=!?&|\sµμ°]+$/;

function normalize(source) {
  return String(source || '')
    .trim()
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/π/g, 'pi')
    .replace(/τ/g, 'tau')
    .replace(/√/g, 'sqrt')
    .replace(/∛/g, 'cbrt')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/⁴/g, '^4')
    .replace(/°/g, ' deg ');
}

function preparePercent(source) {
  let value = String(source || '').trim();
  let match = value.match(/^(.+?)\s*%\s*(?:of|×)\s*(.+)$/i);

  if (match) {
    value = '((' + match[1] + ')/100)*(' + match[2] + ')';
  }

  match = value.match(/^(.+?)\s*%\s*(?:increase|more)\s+(?:on|than)\s+(.+)$/i);
  if (match) {
    value = '(' + match[2] + ')*(1+(' + match[1] + '/100))';
  }

  match = value.match(/^(.+?)\s*%\s*(?:decrease|less)\s+(?:from|than|on)\s+(.+)$/i);
  if (match) {
    value = '(' + match[2] + ')*(1-(' + match[1] + '/100))';
  }

  match = value.match(/^(.+?)\s+(?:is\s+)?what\s*%\s*(?:of|from)\s+(.+)$/i);
  if (match) {
    value = '((' + match[1] + ')/(' + match[2] + '))*100';
  }

  value = value
    .replace(/\bnCr\b/gi, 'combinations')
    .replace(/\bnPr\b/gi, 'permutations')
    .replace(
      /(\d+(?:\.\d+)?)\s*%(?!\s*(?:of|increase|decrease|more|less)\b)/gi,
      '($1/100)'
    );

  return value;
}

function safeExpression(source) {
  const value = String(source || '').trim();

  if (!value || value.length > 1000) return false;
  if (UNSAFE.test(value)) return false;
  if (/["'{}:$\\]/.test(value)) return false;
  if (/(^|[^=!<>])=([^=]|$)/.test(value)) return false;

  return SAFE_CHARS.test(value);
}

function evaluate(source, scope = {}) {
  const prepared = normalize(preparePercent(source));
  if (!safeExpression(prepared)) return null;

  try {
    const result = math.evaluate(prepared, scope);
    return result === undefined ? null : result;
  } catch {
    return null;
  }
}

function format(value) {
  if (value == null) return null;

  try {
    return math.format(value, {
      precision: 12,
      lowerExp: -9,
      upperExp: 12
    });
  } catch {
    return String(value);
  }
}

function promptExpression(text) {
  return String(text || '')
    .trim()
    .replace(/^(?:nero[,:]?\s*)/i, '')
    .replace(/^(?:please\s+)?(?:calculate|compute|evaluate|work\s+out)\s+/i, '')
    .replace(/^(?:please\s+)?what(?:'s| is)\s+/i, '')
    .replace(/^how\s+much\s+is\s+/i, '')
    .replace(/\?+$/, '')
    .trim();
}

function solveEquation(source) {
  const equation = String(source || '').trim();
  const at = equation.indexOf('=');
  if (at < 0) return null;

  const left = equation.slice(0, at);
  const right = equation.slice(at + 1);
  const variable = (equation.match(/\b([A-Za-z])\b/g) || [])
    .find(name => !/^e$/i.test(name)) || 'x';

  const f = x => {
    const a = evaluate(left, { [variable]: x });
    const b = evaluate(right, { [variable]: x });
    if (a == null || b == null) return null;

    const av = Number(a);
    const bv = Number(b);
    return Number.isFinite(av) && Number.isFinite(bv)
      ? av - bv
      : null;
  };

  const y0 = f(0);
  const y1 = f(1);
  const ym1 = f(-1);
  const y2 = f(2);

  if (
    [y0, y1, ym1, y2].some(
      v => !Number.isFinite(v)
    )
  ) {
    return null;
  }

  const a = (y2 - 2 * y1 + y0) / 2;
  const b = y1 - y0 - a;
  const c = y0;

  if (Math.abs(a) < 1e-10) {
    if (Math.abs(b) < 1e-10) {
      return Math.abs(c) < 1e-10
        ? 'Every real value is a solution.'
        : 'No solution.';
    }

    return (
      variable +
      ' = ' +
      format(-c / b) +
      '.'
    );
  }

  const d = b * b - 4 * a * c;

  if (d < 0) {
    const real = -b / (2 * a);
    const imaginary =
      Math.sqrt(-d) / Math.abs(2 * a);

    return (
      variable +
      ' = ' +
      format(real) +
      ' + ' +
      format(imaginary) +
      'i or ' +
      variable +
      ' = ' +
      format(real) +
      ' - ' +
      format(imaginary) +
      'i.'
    );
  }

  if (Math.abs(d) < 1e-12) {
    return (
      variable +
      ' = ' +
      format(-b / (2 * a)) +
      '.'
    );
  }

  const root = Math.sqrt(d);

  return (
    variable +
    ' = ' +
    format(
      (-b + root) / (2 * a)
    ) +
    ' or ' +
    variable +
    ' = ' +
    format(
      (-b - root) / (2 * a)
    ) +
    '.'
  );
}

function numericalIntegral(
  expression,
  variable,
  lower,
  upper
) {
  const a = Number(lower);
  const b = Number(upper);

  if (
    !Number.isFinite(a) ||
    !Number.isFinite(b)
  ) {
    return null;
  }

  if (a === b) return 0;

  const intervals = 800;
  const step =
    (b - a) / intervals;

  let total = 0;

  for (
    let index = 0;
    index <= intervals;
    index++
  ) {
    const x =
      a + step * index;

    const value = Number(
      evaluate(
        expression,
        { [variable]: x }
      )
    );

    if (!Number.isFinite(value)) {
      return null;
    }

    const weight =
      index === 0 ||
      index === intervals
        ? 1
        : index % 2 === 0
          ? 2
          : 4;

    total += weight * value;
  }

  return total * step / 3;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit++) {
      crc =
        (crc >>> 1) ^
        (
          (crc & 1)
            ? 0xedb88320
            : 0
        );
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name =
    Buffer.from(
      type,
      'ascii'
    );

  const length =
    Buffer.alloc(4);

  const checksum =
    Buffer.alloc(4);

  length.writeUInt32BE(
    data.length,
    0
  );

  checksum.writeUInt32BE(
    crc32(
      Buffer.concat([
        name,
        data
      ])
    ),
    0
  );

  return Buffer.concat([
    length,
    name,
    data,
    checksum
  ]);
}

function plotPng(
  width,
  height,
  draw
) {
  const pixels =
    Buffer.alloc(
      width * height * 4,
      255
    );

  const setPixel =
    (
      x,
      y,
      red,
      green,
      blue,
      alpha = 255
    ) => {
      const px =
        Math.round(x);

      const py =
        Math.round(y);

      if (
        px < 0 ||
        py < 0 ||
        px >= width ||
        py >= height
      ) {
        return;
      }

      const offset =
        (py * width + px) *
        4;

      pixels[offset] = red;
      pixels[offset + 1] = green;
      pixels[offset + 2] = blue;
      pixels[offset + 3] = alpha;
    };

  const line =
    (
      x0,
      y0,
      x1,
      y1,
      red,
      green,
      blue
    ) => {
      let x =
        Math.round(x0);

      let y =
        Math.round(y0);

      const targetX =
        Math.round(x1);

      const targetY =
        Math.round(y1);

      const dx =
        Math.abs(
          targetX - x
        );

      const stepX =
        x < targetX
          ? 1
          : -1;

      const dy =
        -Math.abs(
          targetY - y
        );

      const stepY =
        y < targetY
          ? 1
          : -1;

      let error =
        dx + dy;

      while (true) {
        setPixel(
          x,
          y,
          red,
          green,
          blue
        );

        if (
          x === targetX &&
          y === targetY
        ) {
          break;
        }

        const twice =
          2 * error;

        if (twice >= dy) {
          error += dy;
          x += stepX;
        }

        if (twice <= dx) {
          error += dx;
          y += stepY;
        }
      }
    };

  draw({
    setPixel,
    line
  });

  const rows = [];

  for (
    let y = 0;
    y < height;
    y++
  ) {
    const row =
      Buffer.alloc(
        width * 4 + 1
      );

    pixels.copy(
      row,
      1,
      y * width * 4,
      (y + 1) * width * 4
    );

    rows.push(row);
  }

  const compressed =
    deflateSync(
      Buffer.concat(rows),
      { level: 6 }
    );

  const signature =
    Buffer.from([
      137, 80, 78, 71,
      13, 10, 26, 10
    ]);

  const header =
    Buffer.alloc(13);

  header.writeUInt32BE(
    width,
    0
  );

  header.writeUInt32BE(
    height,
    4
  );

  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    signature,
    chunk(
      'IHDR',
      header
    ),
    chunk(
      'IDAT',
      compressed
    ),
    chunk(
      'IEND',
      Buffer.alloc(0)
    )
  ]);
}

function graph(
  expression,
  xMin = -10,
  xMax = 10
) {
  if (
    !safeExpression(
      normalize(expression)
    )
  ) {
    return null;
  }

  if (
    !Number.isFinite(xMin) ||
    !Number.isFinite(xMax) ||
    xMin === xMax
  ) {
    return null;
  }

  const width = 720;
  const height = 440;
  const padding = 48;
  const samples = 500;
  const points = [];

  let yMin = Infinity;
  let yMax = -Infinity;

  if (xMin > xMax) {
    [xMin, xMax] = [
      xMax,
      xMin
    ];
  }

  for (
    let index = 0;
    index <= samples;
    index++
  ) {
    const x =
      xMin +
      (
        (xMax - xMin) *
        index /
        samples
      );

    const y =
      Number(
        evaluate(
          expression,
          { x }
        )
      );

    if (
      !Number.isFinite(y) ||
      Math.abs(y) > 1e12
    ) {
      points.push(null);
      continue;
    }

    points.push({
      x,
      y
    });

    yMin =
      Math.min(
        yMin,
        y
      );

    yMax =
      Math.max(
        yMax,
        y
      );
  }

  if (
    !Number.isFinite(yMin) ||
    !Number.isFinite(yMax)
  ) {
    return null;
  }

  if (
    Math.abs(
      yMax - yMin
    ) < 1e-9
  ) {
    yMin -= 1;
    yMax += 1;
  } else {
    const margin =
      (
        yMax - yMin
      ) * 0.08;

    yMin -= margin;
    yMax += margin;
  }

  const mapX =
    x =>
      padding +
      (
        (x - xMin) /
        (xMax - xMin)
      ) *
      (
        width -
        2 * padding
      );

  const mapY =
    y =>
      height -
      padding -
      (
        (y - yMin) /
        (yMax - yMin)
      ) *
      (
        height -
        2 * padding
      );

  return plotPng(
    width,
    height,
    ({
      setPixel,
      line
    }) => {
      for (
        let x = 0;
        x < width;
        x++
      ) {
        for (
          let y = 0;
          y < height;
          y++
        ) {
          const inside =
            x >= padding &&
            x < width - padding &&
            y >= padding &&
            y < height - padding;

          setPixel(
            x,
            y,
            inside ? 250 : 255,
            inside ? 250 : 255,
            inside ? 252 : 255
          );
        }
      }

      const range =
        Math.max(
          Math.abs(xMin),
          Math.abs(xMax),
          Math.abs(yMin),
          Math.abs(yMax),
          1
        );

      const raw =
        range / 5;

      const power =
        10 ** Math.floor(
          Math.log10(raw)
        );

      const normalized =
        raw / power;

      const step =
        (
          normalized <= 1
            ? 1
            : normalized <= 2
              ? 2
              : normalized <= 5
                ? 5
                : 10
        ) * power;

      for (
        let x =
          Math.ceil(
            xMin / step
          ) * step;
        x <= xMax;
        x += step
      ) {
        const px =
          mapX(x);

        line(
          px,
          padding,
          px,
          height - padding,
          226,
          226,
          230
        );
      }

      for (
        let y =
          Math.ceil(
            yMin / step
          ) * step;
        y <= yMax;
        y += step
      ) {
        const py =
          mapY(y);

        line(
          padding,
          py,
          width - padding,
          py,
          226,
          226,
          230
        );
      }

      if (
        xMin <= 0 &&
        xMax >= 0
      ) {
        const px =
          mapX(0);

        line(
          px,
          padding,
          px,
          height - padding,
          80,
          80,
          90
        );
      }

      if (
        yMin <= 0 &&
        yMax >= 0
      ) {
        const py =
          mapY(0);

        line(
          padding,
          py,
          width - padding,
          py,
          80,
          80,
          90
        );
      }

      for (
        let index = 1;
        index < points.length;
        index++
      ) {
        const previous =
          points[index - 1];

        const current =
          points[index];

        if (
          !previous ||
          !current
        ) {
          continue;
        }

        if (
          Math.abs(
            current.y -
            previous.y
          ) >
          (
            yMax - yMin
          ) * 1.5
        ) {
          continue;
        }

        line(
          mapX(
            previous.x
          ),
          mapY(
            previous.y
          ),
          mapX(
            current.x
          ),
          mapY(
            current.y
          ),
          45,
          95,
          190
        );
      }
    }
  );
}

export function neroAdvancedMath(
  text
) {
  const original =
    String(text || '').trim();

  if (!original) {
    return null;
  }

  const withoutName =
    original.replace(
      /^(?:nero[,:]?\s*)/i,
      ''
    );

  const graphMatch =
    withoutName.match(
      /^(?:graph|plot|draw(?:\s+(?:a\s+)?)?graph)(?:\s+of)?\s+(?:y\s*=\s*)?(.+?)(?:\s+(?:for\s+)?x\s*(?:from|between|in)\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*(?:to|and|\.\.)\s*(-?(?:\d+(?:\.\d*)?|\.\d+)))?$/i
    );

  if (graphMatch) {
    const expression =
      graphMatch[1].trim();

    const xMin =
      graphMatch[2] == null
        ? -10
        : Number(
            graphMatch[2]
          );

    const xMax =
      graphMatch[3] == null
        ? 10
        : Number(
            graphMatch[3]
          );

    const image =
      graph(
        expression,
        xMin,
        xMax
      );

    if (image) {
      return {
        image,
        mimetype: 'image/png',
        text:
          'Graph: y = ' +
          expression +
          '\n' +
          'x: ' +
          format(xMin) +
          ' to ' +
          format(xMax)
      };
    }
  }

  const solveMatch =
    withoutName.match(
      /^(?:please\s+)?solve\s+(.+?)\??$/i
    );

  if (solveMatch) {
    const solved =
      solveEquation(
        solveMatch[1]
      );

    if (solved != null) {
      return solved;
    }
  }

  const derivativeMatch =
    withoutName.match(
      /^(?:find\s+)?(?:the\s+)?derivative\s+(?:of\s+)?(.+?)(?:\s+with\s+respect\s+to\s+([A-Za-z]))?\??$/i
    );

  if (derivativeMatch) {
    const expression =
      derivativeMatch[1].trim();

    const variable =
      derivativeMatch[2] || 'x';

    if (
      safeExpression(
        normalize(expression)
      )
    ) {
      try {
        return (
          'd/d' +
          variable +
          ' = ' +
          math
            .derivative(
              expression,
              variable
            )
            .toString() +
          '.'
        );
      } catch {}
    }
  }

  const integralMatch =
    withoutName.match(
      /^(?:find\s+)?(?:the\s+)?integral\s+of\s+(.+?)\s+from\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\s+(?:to|and)\s+(-?(?:\d+(?:\.\d*)?|\.\d+))$/i
    );

  if (integralMatch) {
    const result =
      numericalIntegral(
        integralMatch[1],
        'x',
        Number(
          integralMatch[2]
        ),
        Number(
          integralMatch[3]
        )
      );

    if (result != null) {
      return (
        format(result) +
        '.'
      );
    }
  }

  let expression =
    promptExpression(
      original
    );

  expression =
    expression.replace(
      /^what\s+is\s+/i,
      ''
    );

  const result =
    evaluate(
      expression
    );

  if (result == null) {
    return null;
  }

  const rendered =
    format(result);

  return rendered == null
    ? null
    : rendered + '.';
}
