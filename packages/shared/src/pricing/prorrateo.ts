/**
 * Reparte `rentaTotal` entre los salones en proporción a su renta de catálogo.
 *
 * `rentaTotal` incluye horas extra y capilla, que no traen `spaceId` y por eso
 * no se pueden atribuir directamente. Prorratearlas mantiene la identidad
 * `Σ pct_i × base_i == pctPonderado × rentaTotal`: el complemento total no se
 * mueve ni un peso, pero cada renglón del contrato ya multiplica exacto.
 *
 * El último salón absorbe la diferencia del redondeo para que la suma cierre.
 */
export function prorratearRenta(
  rentaCatalogo: Map<string, number>,
  rentaTotal: number,
): Map<string, number> {
  const out = new Map<string, number>();
  const ids = [...rentaCatalogo.keys()];
  if (ids.length === 0) return out;

  const suma = ids.reduce((s, id) => s + (rentaCatalogo.get(id) ?? 0), 0);
  let acumulado = 0;
  ids.forEach((id, i) => {
    const esUltimo = i === ids.length - 1;
    if (esUltimo) {
      out.set(id, Math.round((rentaTotal - acumulado) * 100) / 100);
      return;
    }
    const peso = suma > 0 ? (rentaCatalogo.get(id) ?? 0) / suma : 1 / ids.length;
    const parte = Math.round(rentaTotal * peso * 100) / 100;
    acumulado += parte;
    out.set(id, parte);
  });
  return out;
}
