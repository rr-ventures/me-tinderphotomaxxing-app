"""
Prompts sent to Gemini for photo metadata extraction.

The prompt asks Gemini to analyze a dating/profile photo and return
exactly 6 structured fields as JSON. No filter recommendations,
no explanations — just metadata.
"""

METADATA_PROMPT = """Analyze this dating/profile photo and return JSON only.

Do not recommend filters or edits.
Do not explain your reasoning.
Do not output markdown fences.
Do not output any text besides the JSON object.

Return this exact JSON shape:

{
  "scene_type": "outdoor | indoor | urban | nightlife | unknown",
  "lighting": "natural_warm | natural_cool | golden_hour | artificial | mixed | unknown",
  "photo_quality": 7,
  "face_visible": "yes | partial | no",
  "expression": "warm | neutral | serious | unknown",
  "color_quality": "good | flat | bad_mix | unknown"
}

Field definitions:
- scene_type: What is the OVERALL SETTING of this photo? Focus on the dominant environment, not minor details. outdoor (parks, beaches, nature), indoor (rooms, restaurants, cafes, saunas/spas/gyms/pools as enclosed spaces), urban (city streets, buildings, rooftops), nightlife (bars, clubs, parties, night events with artificial colored lighting), unknown if unclear. If the photo is taken at night outside a building with bright artificial lights, classify based on the primary setting type (e.g. if it's a night street scene, it's "urban"; only use "nightlife" for actual bars/clubs/party settings).
- lighting: What is the DOMINANT light source? Focus on the overall feel, not minor variations. natural_warm (sunny daytime), natural_cool (overcast/shade daytime), golden_hour (sunset/sunrise warm glow), artificial (indoor lights, flash, streetlights at night), mixed (clearly conflicting light sources of different colors), unknown if unclear. Night scenes with consistent artificial lighting should be "artificial", not "mixed".
- photo_quality: Overall quality 0-10. Consider sharpness, exposure, composition, noise. 0=terrible, 5=average phone photo, 8=good, 10=professional. Be consistent: similar-looking photos should get similar scores.
- face_visible: Can you clearly see the person's face? yes (clear, well-lit face), partial (partially obscured, side angle, far away), no (back turned, covered, no person).
- expression: What vibe does the person give? warm (smiling, friendly, approachable), neutral (relaxed, calm), serious (intense, confident), unknown if face not visible.
- color_quality: Are the colors natural and workable? good (balanced or easily correctable tones), flat (dull, washed out, needs brightening), bad_mix (weird color cast from multiple colored light sources that cannot be corrected), unknown if unclear. Night photos with consistent warm or cool lighting should be "good", not "bad_mix".
"""
