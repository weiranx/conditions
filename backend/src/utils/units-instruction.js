'use strict';

// Report/waypoint data handed to the AI is always in the backend's native imperial
// units (°F, mph, ft, inches) regardless of what the user has selected for display.
// This builds an instruction telling the AI which units to render its prose in, so
// AI narratives match what's shown elsewhere in the report.
function describeUnitsInstruction(units) {
  const temperature = units?.temperature === 'c' ? 'Celsius (°C)' : 'Fahrenheit (°F)';
  const wind = units?.wind === 'kph' ? 'kilometers per hour (km/h)' : 'miles per hour (mph)';
  const metric = units?.elevation === 'm';
  const elevation = metric ? 'meters (m)' : 'feet (ft)';
  const distance = metric ? 'kilometers (km)' : 'miles (mi)';
  const depth = metric ? 'centimeters (cm)' : 'inches (in)';
  return `Report values below are in imperial units (°F, mph, ft, inches). In your response, convert every value you mention to: temperature in ${temperature}, wind speed in ${wind}, elevation in ${elevation}, distance in ${distance}, and snow depth/SWE/precipitation in ${depth}. Do not mix unit systems and do not show the original imperial value alongside the converted one.`;
}

module.exports = { describeUnitsInstruction };
