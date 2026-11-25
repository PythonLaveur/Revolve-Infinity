# Movement and arena

Movement, routing and collision response are shared systems. Routes avoid terrain and fixed structures, but do not route around other troops. Contact pushes troops according to their force and mass; buildings and arena structures remain fixed. If a push reaches terrain or a wall, the active displacement is shortened and its movement allowance is still spent. Deployments and summons reject positions that overlap arena edges, terrain, structures or immovable buildings. Overlap with a mobile troop is accepted and pushes existing troops away from the newly added unit.

Manual commands plan a terrain-clear route and then push blocking units along the path. Involuntary displacement preserves the displaced unit's order. Hard control and explicit knockback may interrupt it.

Explicit knockback uses the ability's stat-scaled push force divided by the target's mass. Target force does not resist explicit knockback. Hard control and explicit knockback interrupt charging movement and channeling abilities when those mechanics are present.

Automatic movement is planned and processed one unit at a time. Units receive their intended route before collision response; a blocked route does not hold the whole movement queue. Ground and air movement use their respective terrain and collision rules. The arena layout and collision dimensions are defined in the board and stat data.
