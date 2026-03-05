# Campsite Scene

## Description
An interactive 3D campsite scene rendered in WebGL featuring a tent, campfire, lantern, trees, bottle, and environmental effects including shadows, reflections, and refractions set against a galaxy skybox.

## Team Members
- Amanda Chavarria Pleitez
- Benjamin Forelli
- Ellie Scharpf

## How Each Requirement is Met
1. **3D Models**
- Tent (Tent.obj)
- Campfire (PUSHILIN_campfire.obj)
- Lantern (Stylized_Lantern.obj)

2. **Model Transformations**
- Lantern swings back and forth on the post using a sine wave rotation
- Campfire flames animate with pulsing scale and flicker effects

3. **Point Light / Phong Shading**
- Campfire acts as a point light with attenuation, illuminating the scene using Phong shading with ambient, diffuse, and specular components.

4. **Spotlight**
- Lantern acts as a spotlight casting light straight downward onto the ground

5. **Textured Object**
- Ground uses a grass texture
- Tent uses a linen texture
- Campfire and lantern use their respective diffuse textures
- All have fallback solid color defaults while textures load

6. **Camera Animation**
- Camera orbits the scene automatically when auto-rotate is enabled, and can be manually rotated with arrow keys

7. **Hierarchial Model**
- Lantern post system: post(parent) -> arm(child) -> lantern(grandchild)
- The lantern swings relative to the arm which is attached to the post

8. **Projection Shadow**
- Projection shadows cast by the campfire light onto the ground plane using a shadow matrix
- Shaddows dissapear when the campfire is toggled off

9. **Reflection**
- A puddle near the campfire reflects the skybox stars and sky using cubemap environment mapping with an animated surface normal to simulate water ripples

10. **Refraction** - still working on
- A glass bottle near the campfire demonstrates refraction using an exaggerated index of refraction (0.5 instead of real glass 0.67) to make the bending effect visible.

11. **Skybox**
- A galaxy/night sky cubemap surrounds the entire scene using a TEXTURE_CUBE_MAP with 6 faces

12. **Keyboard Controls**
- Arrow Keys: Manually rotate camera
- C: Toggle camera auto-rotation on/off
- S: Toggle shadows on/off
- D: Toggle campfire point light on/off (shadows and fire crackle sound disappear with it)
- A: Toggle lantern swing animation on/off
- M: Toggle all sounds on/off

## Additional Instructions
- Open index.html through a local server as OBJ and texture files require HTTP to load
- All models must be in the /models directory
- All textures must be in the /textures directory
- All audio must be in the /audio directory

## Challenges
- talk about bottle refraction

## Group Responsibilities
**Amanda**
-
**Benjamin**
-
**Ellie**
- Made base model