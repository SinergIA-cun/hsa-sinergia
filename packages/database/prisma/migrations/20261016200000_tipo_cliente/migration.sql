-- Cliente o empresa (Fernando, 16-oct-2026): igual que el tipo del profesional,
-- al elegir "Cliente o empresa" se termina de elegir cuál de los dos es. Los que
-- ya existían quedan sin tipo (null) hasta que alguien edite su evento.
CREATE TYPE "TipoCliente" AS ENUM ('persona', 'empresa');
ALTER TABLE "Client" ADD COLUMN "tipo" "TipoCliente";
