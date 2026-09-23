# Reference Platformer — arte original

Estas duas imagens são conceitos originais gerados para o template builtin `reference_platformer`:

- `fox-concept.png`: raposinha aventureira kawaii com cachecol vermelho e espada de madeira, em cinco poses.
- `environment-concept.png`: portão de madeira, bandeira de chegada, terreno, nuvens e céu.

Modo de geração: imagens raster novas, sem imagem de referência e sem ativos comerciais. Direção visual: pixel art 16-bit legível, formas fofas porém corajosas, silhuetas claras e cores quentes para a personagem contra céu azul. Estas imagens são estudos de direção artística, não assets carregados diretamente pelo jogo.

Os pixels de produção foram redesenhados em `reference_player_png`, `reference_goal_png`, `reference_passage_png` e `reference_tileset_ppm` no backend canônico. Os sprites são PNG com alfa real para que o estágio SGDK converta o fundo em índice transparente; o cenário permanece PPM opaco. O sprite final tem cinco poses de 16×16; a bandeira mede 16×16, o portão 16×32 e o cenário 320×224. Cada recurso usa no máximo 16 cores na sua paleta Mega Drive. O template continua **Experimental** e autocontido; nenhuma ROM ou asset BYOR foi incorporado.
